const Boom = require('@hapi/boom');
const Util = require('@coderich/util');
const Pipeline = require('./Pipeline');
const QueryResolver = require('../query/QueryResolver');
const { paginateResults } = require('../service/AppService');

module.exports = class Resolver {
  #schema;
  #context;

  constructor(config) {
    this.#schema = config.schema;
    this.#context = config.context;
  }

  getContext() {
    return this.#context;
  }

  match(model) {
    return new QueryResolver({
      resolver: this,
      schema: this.#schema,
      context: this.#context,
      query: { model },
    });
  }

  query(query) {
    return this.resolve(query.resolve());
  }

  async resolve(query) {
    const model = this.#schema.models[query.model];
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[query.crud] || [];

    return model.source.driver.resolve(Object.defineProperties(query.$clone({
      get before() {
        if (!query.isCursorPaging || !query.before) return undefined;
        return JSON.parse(Buffer.from(query.before, 'base64').toString('ascii'));
      },
      get after() {
        if (!query.isCursorPaging || !query.after) return undefined;
        return JSON.parse(Buffer.from(query.after, 'base64').toString('ascii'));
      },
    }), {
      $model: { value: model },
    })).then((data) => {
      const { flags } = query;
      if (data == null && flags.required) throw Boom.notFound();
      if (data == null) return null; // Explicit return null;
      if (query.isCursorPaging) data = paginateResults(data, query);
      return this.#normalize(query, model, data, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$deserialize', '$transform'].map(el => Pipeline[el]));
    });
  }

  async #normalize(query, model, data, transformers = [], paths = []) {
    if (data == null) return data;
    if (typeof data !== 'object') return data;

    return Util.mapPromise(data, (doc) => {
      return Util.pipeline(Object.entries(doc).map(([key, startValue]) => async (prev) => {
        const [$key] = Object.entries(model.keyMap || {}).find(([k, v]) => v === key) || [key];
        const field = model.fields[$key];
        const path = paths.concat($key);

        // Remove fields not defined in schema
        if (!field) return prev;

        // Transform value
        let $value = await Util.pipeline(transformers.map(t => async (value) => {
          const v = await t({ query, model, field, value, path, startValue, resolver: this, context: this.#context });
          return v === undefined ? value : v;
        }), startValue);

        // If it's embedded - delegate
        if (field.model && !field.isFKReference) {
          $value = await this.#normalize(query, field.model, $value, transformers, paths.concat($key));
        }

        return Object.assign(prev, { [$key]: $value });
      }), Object.defineProperties({}, {
        $pageInfo: { value: doc.$pageInfo },
        $cursor: { value: doc.$cursor },
      }));
    });
  }
};
