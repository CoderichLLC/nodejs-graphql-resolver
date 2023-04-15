const merge = require('lodash.merge');
const Util = require('@coderich/util');
const Pipeline = require('./Pipeline');
const QueryBuilder = require('./QueryBuilder');

module.exports = class QueryResolver extends QueryBuilder {
  #model;
  #schema;
  #context;
  #resolver;
  #arrayOp;

  constructor(config) {
    const { schema, context, resolver, query, arrayOp = '$eq' } = config;
    super(query);
    this.#schema = schema;
    this.#context = context;
    this.#resolver = resolver;
    this.#arrayOp = arrayOp;
    this.#model = schema.models[query.model];
  }

  clone(q) {
    const query = super.clone(q).resolve();
    return new QueryResolver({ schema: this.#schema, resolver: this.#resolver, query });
  }

  resolve() {
    const query = super.resolve();
    const { crud, where, input, select = Object.values(this.#model.fields).map(field => field.name) } = query;
    const crudLines = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] }[crud] || [];

    query.input = this.#normalize('input', this.#model, input, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$serialize', '$transform'].map(el => Pipeline[el]));
    query.where = this.#normalize('where', this.#model, Util.unflatten(where), ['castValue', '$instruct', '$serialize'].map(el => Pipeline[el]));
    query.select = this.#normalize('select', this.#model, Util.unflatten(select.reduce((prev, field) => Object.assign(prev, { [field]: true }), {})));

    return this.#resolver.resolve(query);
  }

  #normalize(target, model, data, transformers = []) {
    if (typeof data !== 'object') return data;

    const defaultInput = Object.values(model.fields).filter(field => Object.prototype.hasOwnProperty.call(field, 'defaultValue')).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const instructFields = Object.values(model.fields).filter(field => field.pipelines?.instruct).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});

    // Next we normalize the $data
    const $data = Util.map(data, (doc) => {
      if (target === 'input') merge(doc, defaultInput, doc, instructFields);
      else if (target === 'where') merge(doc, instructFields);

      return Object.entries(doc).reduce((prev, [key, startValue]) => {
        let [$key] = key.split('.');
        const field = model.fields[$key];
        if (!field) return Object.assign(prev, { [key]: startValue }); // "key" is correct here to preserve namespace
        $key = field.key || key;

        // Transform value
        let $value = transformers.reduce((value, t) => {
          const v = t({ model, field, value, startValue, resolver: this.#resolver, context: this.#context });
          // const v = t({ base, model, field, path, docPath, rootPath, parentPath, startValue, value, resolver, context });
          return v === undefined ? value : v;
        }, startValue);

        // If it's embedded - delegate
        if (field.model && !field.isFKReference) {
          $value = this.#normalize(target, field.model, $value, transformers);
        }

        // Assign it back
        return Object.assign(prev, { [$key]: $value });
      }, {});
    });

    return $data;
  }
};
