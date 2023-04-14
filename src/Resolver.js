const { map } = require('@coderich/util');
const Pipeline = require('./Pipeline');
const QueryResolver = require('./QueryResolver');

module.exports = class Resolver {
  #config;

  constructor(config) {
    this.#config = config;
  }

  match(model) {
    return new QueryResolver({ resolver: this, schema: this.#config.schema, query: { model } });
  }

  query(query) {
    return this.resolve(query.resolve());
  }

  resolve(query) {
    const model = this.#config.schema.models[query.model];
    return this.#config.mongoClient.resolve(query).then(data => this.#normalize(model, data, ['defaultValue', 'castValue', 'ensureArrayValue'].map(el => Pipeline[el])));
  }

  #normalize(model, data, transformers = []) {
    // console.log(data);
    if (data == null) return null;
    if (typeof data !== 'object') return data;

    const $data = map(data, (doc) => {
      return Object.entries(doc).reduce((prev, [key, value]) => {
        const [$key] = Object.entries(model.keyMap || {}).find(([k, v]) => v === key) || [key];
        const field = model.fields[$key];

        // Remove fields not defined in schema
        if (!field) return prev;

        // Transform value
        const $value = transformers.reduce((val, t) => {
          const v = t({ model, field, value: val });
          // const v = t({ base, model, field, path, docPath, rootPath, parentPath, startValue, value, resolver, context });
          return v === undefined ? val : v;
        }, value);

        return Object.assign(prev, { [$key]: $value });
      }, {});
    });

    return $data;
  }
};
