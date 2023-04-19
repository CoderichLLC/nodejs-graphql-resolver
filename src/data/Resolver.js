const Boom = require('@hapi/boom');
const Util = require('@coderich/util');
const Pipeline = require('./Pipeline');
const QueryResolver = require('../query/QueryResolver');

module.exports = class Resolver {
  #schema;
  #context;
  #driver;

  constructor(config) {
    this.#driver = config.driver;
    this.#schema = config.schema;
    this.#context = config.context;
  }

  idValue(value) {
    return this.#driver.idValue(value);
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

  resolve(query) {
    const model = this.#schema.models[query.model];
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[query.crud] || [];
    return this.#driver.resolve(query).then((data) => {
      const { flags } = query;
      if (data == null && flags.required) throw Boom.notFound();
      return this.#normalize(model, data, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$deserialize', '$transform'].map(el => Pipeline[el]));
    });
  }

  async #normalize(model, parent, transformers = [], paths = [], root = parent) {
    if (parent == null) return null;
    if (typeof parent !== 'object') return parent;

    return Util.mapPromise(parent, (doc) => {
      return Util.promiseChain(Object.entries(doc).map(([key, startValue]) => async (chain) => {
        const prev = chain.pop();
        const [$key] = Object.entries(model.keyMap || {}).find(([k, v]) => v === key) || [key];
        const field = model.fields[$key];
        const path = paths.concat($key);

        // Remove fields not defined in schema
        if (!field) return prev;

        // Transform value
        let $value = await Util.promiseChain(transformers.map(t => async (ch) => {
          const value = ch.pop();
          const v = await t({ root, parent, model, field, value, path, startValue, resolver: this, context: this.#context });
          return v === undefined ? value : v;
        }), startValue).then(ch => ch.pop());

        // If it's embedded - delegate
        if (field.model && !field.isFKReference) {
          $value = await this.#normalize(field.model, $value, transformers, paths.concat($key), root);
        }

        return Object.assign(prev, { [$key]: $value });
      }), {}).then(chain => chain.pop());
    });
  }
};
