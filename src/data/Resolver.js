const Boom = require('@hapi/boom');
const Util = require('@coderich/util');
const Loader = require('./Loader');
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
    this.#loaders = this.#newLoaders();
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
   *
   * @param {string|object} model - The name (string) or model (object) you wish to query
   * @returns {QueryResolver|QueryResolverTransaction} - A chainable API to build and execute a query
   */
  match(model) {
    return this.#sessions.slice(-1).pop()?.slice(-1).pop()?.transaction?.match(model) ?? new QueryResolver({
      resolver: this,
      schema: this.#schema,
      context: this.#context,
      query: { model: `${model}` },
    });
  }

  /**
   * Start a new transaction.
   *
   * @param {boolean} isolated - Create the transaction in isolation from other queries
   * @returns {Resolver} - A Resolver instance to construct queries in a transaction
   */
  transaction(isolated = true, parent = this) {
    if (isolated) return this.clone().transaction(false, parent);

    const currSession = this.#sessions.slice(-1).pop();
    const prevTransaction = currSession?.slice(-1).pop();

    const newTransaction = {
      transaction: new Transaction({ resolver: this, schema: this.#schema, context: this.#context }),
    };

    // The linkedTransaction links in to the previous transaction
    // The reason for the commit() & rollback() is that when the "resolver" is run
    // the entire session group is popped and executed - this is a noop since it's bound to prevTransaction
    const linkedTransaction = {
      transaction: {
        match: (...args) => prevTransaction?.transaction?.match(...args),
        commit: () => Promise.resolve(currSession.pop()),
        rollback: () => Promise.resolve(currSession.pop()),
      },
    };

    if (prevTransaction) currSession.push(newTransaction);

    this.#sessions.push(Object.defineProperties([prevTransaction ? linkedTransaction : newTransaction], {
      parent: { value: parent },
      thunks: { value: prevTransaction ? currSession.thunks : [] }, // Cleanup functions to run after session is committed
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

    return Util.promiseChain(session.map(({ transaction }) => () => {
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

    return Util.promiseChain(session.map(({ transaction }) => () => {
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
   * @param {object} query - An instance of Query.toObject(); a normalized query object that has been transformed.
   * @returns {*} - The resolved query data
   */
  resolve(query) {
    let promise;
    const model = this.#schema.models[query.model];
    const currSession = this.#sessions.slice(-1).pop();

    if (query.isMutation) {
      promise = model.source.client.resolve(query.$toDriver()).then((results) => {
        this.clear(query.model);
        currSession?.thunks.push(...this.#sessions.map(s => () => s.parent.clear(query.model)));
        return results;
      });
    } else {
      promise = this.#loaders[model].resolve(query);
    }

    return promise.then((data) => {
      if (query.flags?.required && (data == null || data?.length === 0)) throw Boom.notFound();
      return this.toResultSet(model, data, query);
    });
  }

  toResultSet(model, data, query = {}) {
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[query.crud] || [];
    const $model = this.#schema.models[model];
    return this.#finalize(query, $model, data, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$deserialize', '$transform'].map(el => Pipeline[el]));
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

  #newLoaders() {
    return Object.entries(this.#schema.models).filter(([key, value]) => {
      return value.loader && value.isEntity;
    }).reduce((prev, [key, value]) => {
      return Object.assign(prev, { [key]: new Loader(value) });
    }, {});
  }
};
