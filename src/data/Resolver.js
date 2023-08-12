const Boom = require('@hapi/boom');
const Util = require('@coderich/util');
const Loader = require('./Loader');
const Emitter = require('./Emitter');
const Pipeline = require('./Pipeline');
const Transaction = require('./Transaction');
const QueryResolver = require('../query/QueryResolver');

module.exports = class Resolver {
  #schema;
  #context;
  #loaders;
  #sessions = []; // Holds nested 2D array of transactions

  constructor(config) {
    this.#schema = config.schema;
    this.#context = config.context;
    this.#loaders = this.#createNewLoaders();
    this.driver = this.raw; // Alias
  }

  getContext() {
    return this.#context;
  }

  clear(model) {
    this.#loaders[model].clearAll();
    return this;
  }

  clearAll() {
    Object.values(this.#loaders).forEach(loader => loader.clearAll());
    return this;
  }

  clone() {
    return new Resolver({
      schema: this.#schema,
      context: this.#context,
    });
  }

  raw(model) {
    return this.toModel(model)?.source?.client?.driver(model);
  }

  /**
   * Create and execute a query for a provided model.
   *
   * @param {string|object} model - The name (string) or model (object) you wish to query
   * @returns {QueryResolver|QueryResolverTransaction} - An API to build and execute a query
   */
  match(model) {
    return this.#sessions.slice(-1).pop()?.slice(-1).pop()?.match(model) ?? new QueryResolver({
      resolver: this,
      schema: this.#schema,
      context: this.#context,
      query: { model: `${model}` },
    });
  }

  /**
   * Start a new transaction.
   *
   * @param {boolean} isolated - Create the transaction in isolation (new resolver)
   * @param {Resolver} parent - The parent resolver that created this transaction
   * @returns {Resolver} - A Resolver instance to construct queries in a transaction
   */
  transaction(isolated = true, parent = this) {
    if (isolated) return this.clone().transaction(false, parent);

    const currSession = this.#sessions.slice(-1).pop();
    const currTransaction = currSession?.slice(-1).pop();
    const realTransaction = new Transaction({ resolver: this, schema: this.#schema, context: this.#context });
    const thunks = currTransaction ? currSession.thunks : []; // If in a transaction, piggy back off session

    // If we're already in a transaction; add the "real" transaction to the existing session
    // We do this because a "session" holds a group of transactions all bound to the same resolver
    // Therefore this transaction should resolve when THAT resolver is committed or rolled back
    if (currTransaction) currSession.push(realTransaction);

    // In the case where we are currently in a transaction we need to create a hybrid transaction
    // This transaction is part "real" transaction and part "current" transaction...
    // This transaction ultimately calls currSession.pop() to remove itself (all transactions do)
    const hybridTransaction = {
      match: (...args) => currTransaction?.match(...args), // Bound to current transaction
      commit: () => Promise.resolve(currSession.pop()), // DO NOT COMMIT! It's fate to commit is in "currSession"!
      rollback: () => realTransaction.rollback().then(() => currSession.pop()), // REALLY, we need to rollback()
    };

    // In ALL cases we MUST create a new session with either the real or hybrid transaction!
    // It is THIS transaction API that is used when resolver.match() is called
    // Additional attributes are defined for use in order to clear data loader cache during transactions
    this.#sessions.push(Object.defineProperties([currTransaction ? hybridTransaction : realTransaction], {
      parent: { value: parent }, // The parent resolver
      thunks: { value: thunks }, // Cleanup functions to run after session is completed (references parent)
    }));

    return this;
  }

  /**
   * Auto run (commit or rollback) the current transaction based on the outcome of a provided promise.
   *
   * @param {Promise} promise - A promise to resolve that determines the fate of the current transaction
   * @returns {*} - The promise resolution
   */
  run(promise) {
    return promise.then((results) => {
      return this.commit().then(() => results);
    }).catch((e) => {
      return this.rollback().then(() => Promise.reject(e));
    });
  }

  /**
   * Commit the current transaction.
   */
  commit() {
    let op = 'commit';
    const errors = [];
    const session = this.#sessions.pop()?.reverse();

    // All transactions bound to this resolver are to be committed
    return Util.promiseChain(session.map(transaction => () => {
      return transaction[op]().catch((e) => {
        op = 'rollback';
        errors.push(e);
        return transaction[op]().catch(ee => errors.push(ee));
      });
    })).then(() => {
      return errors.length ? Promise.reject(errors) : Promise.all(session.thunks.map(thunk => thunk()));
    });
  }

  /**
   * Rollback the current transaction
   */
  rollback() {
    const errors = [];
    const session = this.#sessions.pop()?.reverse();

    // All transactions bound to this resolver are to be rolled back
    return Util.promiseChain(session.map(transaction => () => {
      transaction.rollback().catch(e => errors.push(e));
    })).then(() => {
      return errors.length ? Promise.reject(errors) : Promise.all(session.thunks.map(thunk => thunk()));
    });
  }

  /**
   * Resolve a query.
   *
   * This method ultimately delegates to a DataSource (for mutations) otherwise a DataLoader.
   *
   * @param {Query} query - The query to resolve
   * @returns {*} - The resolved query result
   */
  async resolve(query) {
    let thunk;
    const tquery = await query.transform();
    const { model: modelName, isMutation, flags } = tquery.toObject();
    const model = this.#schema.models[modelName];
    const currSession = this.#sessions.slice(-1).pop();

    if (isMutation) {
      thunk = () => model.source.client.resolve(tquery.toDriver().toObject()).then((results) => {
        // We clear the cache immediately (regardless if we're in transaction or not)
        this.clear(model);

        // If we're in a transaction, we clear the cache of all sessions when this session resolves
        currSession?.thunks.push(...this.#sessions.map(s => () => s.parent.clear(model)));

        // Return results
        return results;
      });
    } else {
      thunk = () => this.#loaders[model].resolve(tquery);
    }

    return this.#createSystemEvent(query, tquery, thunk).then((result) => {
      if (flags?.required && (result == null || result?.length === 0)) throw Boom.notFound();
      return this.toResultSet(model, result, tquery.toObject());
    });
  }

  toResultSet(model, result, query = {}) {
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[query.crud] || [];
    const $model = this.#schema.models[model];
    return this.#finalize(query, $model, result, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$deserialize', '$transform'].map(el => Pipeline[el]));
  }

  toModel(model) {
    return typeof model === 'string' ? this.#schema.models[model] : model;
  }

  toModelMarked(model) {
    const marked = this.toModel(model);
    if (!marked) throw new Error(`${model} is not defined in schema`);
    if (!marked.isMarkedModel) throw new Error(`${model} is not a marked model`);
    return marked;
  }

  toModelEntity(model) {
    const entity = this.toModel(model);
    if (!entity) throw new Error(`${model} is not defined in schema`);
    if (!entity.isEntity) throw new Error(`${model} is not an entity`);
    return entity;
  }

  #finalize(query, model, data, transformers = [], paths = []) {
    if (data == null) return data;
    if (typeof data !== 'object') return data;

    return Util.mapPromise(data, (doc) => {
      return Util.pipeline(Object.entries(doc).map(([key, startValue]) => async (prev) => {
        const field = Object.values(model.fields).find(el => el.key === key);
        if (!field) return prev; // Remove fields not defined in schema

        // Transform value
        let $value = await Util.pipeline(transformers.map(t => async (value) => {
          const v = await t({ query, model, field, value, path: paths.concat(field.name), startValue, resolver: this, context: this.#context });
          return v === undefined ? value : v;
        }), startValue);

        // If it's embedded - delegate
        if (field.model && !field.isFKReference) {
          $value = await this.#finalize(query, field.model, $value, transformers, paths.concat(field.name));
        }

        return Object.assign(prev, { [field.name]: $value });
      }), Object.defineProperties({}, {
        $pageInfo: { value: doc.$pageInfo },
        $cursor: { value: doc.$cursor },
      }));
    });
  }

  #createNewLoaders() {
    return Object.entries(this.#schema.models).filter(([key, value]) => {
      return value.loader && value.isEntity;
    }).reduce((prev, [key, value]) => {
      return Object.assign(prev, { [key]: new Loader(value) });
    }, {});
  }

  #createSystemEvent(oquery, tquery, thunk = () => {}) {
    const args = oquery.toObject();
    const query = tquery.toObject();
    const type = query.isMutation ? 'Mutation' : 'Query';
    const event = { context: this.#context, resolver: this, query, args };

    return Emitter.emit(`pre${type}`, event).then((result) => {
      return query.isMutation ? Promise.all([
        tquery.pipeline('input', query.input, ['$validate']), // Because input is merged
        Emitter.emit('validate', event),
      ]).then(() => result) : result;
    }).then((result) => {
      return result === undefined ? thunk() : result; // It's possible to by-pass thunk
    }).then((result) => {
      event.result = result;
      return Emitter.emit(`post${type}`, event);
    }).then(() => event.result);

    // .then(() => {
    //   return Emitter.emit('preResponse', event);
    // }).then(() => {
    //   return Emitter.emit('postResponse', event);
    // });
  }
};
