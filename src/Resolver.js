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
    // console.log(JSON.stringify(query, null, 2));

    return this.#config.mongoClient.resolve(query).then((mixed) => {
      if (mixed == null) return null;

      if (typeof mixed !== 'object') return mixed;

      return map(mixed, (doc) => {
        return Object.entries(doc).reduce((prev, [key, value]) => {
          const [$key] = Object.entries(model.keyMap || {}).find(([k, v]) => v === key) || [key];
          const field = model.fields[$key];

          // Remove fields not defined in schema
          if (!field) return prev;

          const pipelines = field?.pipelines?.deserialize?.map(t => Pipeline[t]) || [];

          // Transform value
          const $value = pipelines.reduce((p, t) => {
            const v = t({ model, field, value });
            // const v = t({ base, model, field, path, docPath, rootPath, parentPath, startValue, value, resolver, context });
            return v === undefined ? value : v;
          }, value);

          return Object.assign(prev, { [$key]: $value });
        }, {});
      });
    });
  }
};
