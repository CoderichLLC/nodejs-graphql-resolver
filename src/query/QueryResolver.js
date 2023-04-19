const merge = require('lodash.merge');
const Util = require('@coderich/util');
const QueryBuilder = require('./QueryBuilder');
const Pipeline = require('../data/Pipeline');
const { resolveWhereClause } = require('../service/service');

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

  async resolve() {
    const query = super.resolve();
    const { crud, where, input, select = Object.values(this.#model.fields).map(field => field.name) } = query;
    const crudLines = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] }[crud] || [];

    query.input = await this.#normalize('input', this.#model, input, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$serialize', '$transform', '$validate'].map(el => Pipeline[el]));
    query.where = await this.#normalize('where', this.#model, Util.unflatten(where), ['castValue', 'ensureArrayValue', '$instruct', '$serialize'].map(el => Pipeline[el]));
    query.select = await this.#normalize('select', this.#model, Util.unflatten(select.reduce((prev, field) => Object.assign(prev, { [field]: true }), {})));
    query.where = resolveWhereClause(query.where);

    return this.#resolver.resolve(query);
  }

  async #normalize(target, model, parent, transformers = [], paths = [], root = parent) {
    if (typeof parent !== 'object') return parent;

    const defaultInput = Object.values(model.fields).filter(field => Object.prototype.hasOwnProperty.call(field, 'defaultValue')).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const requiredInput = Object.values(model.fields).filter(field => field.isRequired && field.name !== 'id').reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const instructFields = Object.values(model.fields).filter(field => field.pipelines?.instruct).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});

    // Next we normalize the $data
    return Util.mapPromise(parent, (doc, index) => {
      if (Array.isArray(parent)) paths = paths.concat(index);
      if (target === 'input') merge(doc, defaultInput, requiredInput, doc, instructFields);
      else if (target === 'where') merge(doc, instructFields);

      return Util.promiseChain(Object.entries(doc).map(([key, startValue]) => async (chain) => {
        let [$key] = key.split('.');
        const field = model.fields[$key];
        const prev = chain.pop();
        if (!field) return Object.assign(prev, { [key]: startValue }); // "key" is correct here to preserve namespace
        $key = field.key || key;
        const path = paths.concat(key);

        // Transform value
        let $value = await Util.promiseChain(transformers.map(t => async (ch) => {
          const value = ch.pop();
          const v = await t({ root, parent, path, model, field, value, startValue, resolver: this.#resolver, context: this.#context });
          return v === undefined ? value : v;
        }), startValue).then(ch => ch.pop());

        // If it's embedded - delegate
        if (field.model && !field.isFKReference) {
          $value = await this.#normalize(target, field.model, $value, transformers, paths.concat(key), root);
        }

        // Assign it back
        return Object.assign(prev, { [$key]: $value });
      }), {}).then(chain => chain.pop());
    });
  }
};
