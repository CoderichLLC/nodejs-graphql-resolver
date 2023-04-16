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

  #normalize(model, data, transformers = []) {
    if (data == null) return null;
    if (typeof data !== 'object') return data;

    // console.log(data);

    const $data = Util.map(data, (doc) => {
      return Object.entries(doc).reduce((prev, [key, startValue]) => {
        const [$key] = Object.entries(model.keyMap || {}).find(([k, v]) => v === key) || [key];
        const field = model.fields[$key];

        // Remove fields not defined in schema
        if (!field) return prev;

        // Transform value
        let $value = transformers.reduce((value, t) => {
          const v = t({ model, field, value, startValue, resolver: this, context: this.#context });
          return v === undefined ? value : v;
        }, startValue);

        // If it's embedded - delegate
        if (field.model && !field.isFKReference) {
          $value = this.#normalize(field.model, $value, transformers);
        }

        return Object.assign(prev, { [$key]: $value });
      }, {});
    });

    return $data;
  }
};
