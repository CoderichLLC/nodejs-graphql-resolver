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
  #transactions = [];

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

  match(model) {
    return this.#transactions[this.#transactions.length - 1]?.slice(-1).pop()?.match(model) ?? new QueryResolver({
      resolver: this,
      schema: this.#schema,
      context: this.#context,
      query: { model: `${model}` },
    });
  }

  transaction(isolated = true) {
    if (isolated) return this.clone().transaction(false);

    const newTransaction = new Transaction({ resolver: this, schema: this.#schema, context: this.#context });
    const transactions = this.#transactions[this.#transactions.length - 1];
    const prevTransaction = transactions?.slice(-1).pop();

    const linkedTransaction = {
      match: (...args) => prevTransaction?.match(...args),
      commit: () => Promise.resolve(transactions.pop()),
      rollback: () => Promise.resolve(transactions.pop()),
    };

    if (prevTransaction) transactions.push(newTransaction);
    this.#transactions.push([prevTransaction ? linkedTransaction : newTransaction]);

    return this;
  }

  run(promise) {
    return promise.then((results) => {
      return this.commit().then(() => results);
    }).catch((e) => {
      return this.rollback().then(() => Promise.reject(e));
    });
  }

  commit() {
    let op = 'commit';
    const errors = [];

    return Util.promiseChain(this.#transactions.pop()?.reverse().map(transaction => () => {
      return transaction[op]().catch((e) => {
        op = 'rollback';
        errors.push(e);
        return transaction[op]().catch(ee => errors.push(ee));
      });
    })).then(() => {
      return errors.length ? Promise.reject(errors) : Promise.resolve();
    });
  }

  rollback() {
    const errors = [];

    return Util.promiseChain(this.#transactions.pop()?.reverse().map(transaction => () => {
      transaction.rollback().catch(e => errors.push(e));
    })).then(() => {
      return errors.length ? Promise.reject(errors) : Promise.resolve();
    });
  }

  resolve(query) {
    let promise;
    const model = this.#schema.models[query.model];

    if (query.isMutation) {
      promise = model.source.client.resolve(query.$toDriver()).then((results) => {
        this.clear(query.model);
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
