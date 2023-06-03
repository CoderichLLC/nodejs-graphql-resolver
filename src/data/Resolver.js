const get = require('lodash.get');
const Boom = require('@hapi/boom');
const Util = require('@coderich/util');
const Pipeline = require('./Pipeline');
const Transaction = require('./Transaction');
const QueryResolver = require('../query/QueryResolver');

module.exports = class Resolver {
  #schema;
  #context;

  constructor(config) {
    this.#schema = config.schema;
    this.#context = config.context;
    this.driver = this.raw; // Alias
  }

  getContext() {
    return this.#context;
  }

  raw(model) {
    return this.#toModel(model)?.source?.client?.driver(model);
  }

  match(model) {
    return new QueryResolver({
      resolver: this,
      schema: this.#schema,
      context: this.#context,
      query: { model },
    });
  }

  transaction(parentTxn) {
    return new Transaction(this, parentTxn);
  }

  toResultSet(model, data) {
    const $model = this.#schema.models[model];
    return this.#normalize({}, $model, data);
  }

  async resolve(query) {
    const model = this.#schema.models[query.model];
    const $query = await query.$toDriver(query);
    return model.source.client.resolve($query).then(data => this.#normalize(query, model, data));
  }

  #toModel(model) {
    return typeof model === 'string' ? this.#schema.models[model] : model;
  }

  #toModelMarked(model) {
    const marked = this.toModel(model);
    if (!marked) throw new Error(`${model} is not defined in schema`);
    if (!marked.isMarkedModel) throw new Error(`${model} is not a marked model`);
    return marked;
  }

  // #toModelEntity(model) {
  //   const entity = this.toModel(model);
  //   if (!entity) throw new Error(`${model} is not defined in schema`);
  //   if (!entity.isEntity()) throw new Error(`${model} is not an entity`);
  //   return entity;
  // }

  #normalize(query, model, data) {
    const { flags, crud, isCursorPaging } = query;
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[crud] || [];
    if (flags?.required && (data == null || data?.length === 0)) throw Boom.notFound();
    if (data == null) return null; // Explicit return null;
    if (isCursorPaging) data = Resolver.#paginateResults(data, query);
    return this.#finalize(query, model, data, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$deserialize', '$transform'].map(el => Pipeline[el]));
  }

  async #finalize(query, model, data, transformers = [], paths = []) {
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

  static #paginateResults(rs, query) {
    let hasNextPage = false;
    let hasPreviousPage = false;
    const { first, after, last, before, sort = {} } = query;
    const limiter = first || last;
    const sortPaths = Object.keys(Util.flatten(sort, { safe: true }));

    // Add $cursor data
    Util.map(rs, (doc) => {
      const sortValues = sortPaths.reduce((prev, path) => Object.assign(prev, { [path]: get(doc, path) }), {});
      Object.defineProperty(doc, '$cursor', { value: Buffer.from(JSON.stringify(sortValues)).toString('base64') });
    });

    // First try to take off the "bookends" ($gte | $lte)
    if (rs.length && rs[0].$cursor === after) {
      rs.shift();
      hasPreviousPage = true;
    }

    if (rs.length && rs[rs.length - 1].$cursor === before) {
      rs.pop();
      hasNextPage = true;
    }

    // Next, remove any overage
    const overage = rs.length - (limiter - 2);

    if (overage > 0) {
      if (first) {
        rs.splice(-overage);
        hasNextPage = true;
      } else if (last) {
        rs.splice(0, overage);
        hasPreviousPage = true;
      } else {
        rs.splice(-overage);
        hasNextPage = true;
      }
    }

    // Add $pageInfo
    return Object.defineProperties(rs, {
      $pageInfo: {
        get() {
          return {
            startCursor: get(rs, '0.$cursor', ''),
            endCursor: get(rs, `${rs.length - 1}.$cursor`, ''),
            hasPreviousPage,
            hasNextPage,
          };
        },
      },
    });
  }
};
