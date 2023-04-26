const merge = require('lodash.merge');
const Util = require('@coderich/util');
const QueryBuilder = require('./QueryBuilder');
const Pipeline = require('../data/Pipeline');
const { resolveWhereClause } = require('../service/AppService');

// const crudLines = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] }[crud] || [];

module.exports = class QueryResolver extends QueryBuilder {
  #model;
  #schema;
  #context;
  #resolver;

  constructor(config) {
    const { schema, context, resolver, query } = config;
    super(query);
    this.#schema = schema;
    this.#context = context;
    this.#resolver = resolver;
    this.#model = schema.models[query.model];
  }

  clone(q) {
    const query = super.clone(q).resolve();
    return new QueryResolver({ schema: this.#schema, resolver: this.#resolver, query });
  }

  async resolve() {
    const query = super.resolve();
    const { where, select = Object.values(this.#model.fields).map(field => field.name) } = query;

    // Normalize
    [query.where, query.select] = await Promise.all([
      this.#normalize(query, 'where', this.#model, Util.unflatten(where), ['castValue', '$instruct', '$serialize'].map(el => Pipeline[el])).then(res => resolveWhereClause(Util.flatten(res, false))),
      this.#normalize(query, 'select', this.#model, Util.unflatten(select.reduce((prev, field) => Object.assign(prev, { [field]: true }), {}))),
    ]);

    // Resolve
    switch (query.op) {
      case 'findOne': case 'findMany': case 'count': {
        return this.#resolver.resolve(query);
      }
      case 'createOne': case 'createMany': {
        query.input = await this.#normalize(query, 'input', this.#model, query.input, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', '$construct', '$serialize', '$transform', '$validate'].map(el => Pipeline[el]));
        return this.#resolver.resolve(query);
      }
      case 'updateOne': case 'updateMany': {
        return this.#get(query).then(async (doc) => {
          query.doc = doc;
          query.input = query.merged = await this.#normalize(query, 'input', this.#model, merge({}, doc, query.input), ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', '$restruct', '$serialize', '$transform', '$validate'].map(el => Pipeline[el]));
          return this.#resolver.resolve(query);
        });
      }
      case 'deleteOne': {
        return this.#get(query).then((doc) => {
          query.doc = doc;
          return this.#resolver.resolve(query).then(() => doc);
        });
      }
      case 'deleteMany': {
        return this.#resolver.resolve(query.$clone({ op: 'findMany' })).then((docs) => {
          return Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).delete()));
        });
      }
      default: {
        throw new Error(`Unknown operation "${query.op}"`);
      }
    }
  }

  #get(query) {
    return this.#resolver.match(this.#model.name).where(query.where).one({ required: true });
  }

  async #normalize(query, target, model, data, transformers = [], paths = []) {
    const allFields = Object.values(model.fields).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const instructFields = Object.values(model.fields).filter(field => field.pipelines?.instruct).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});

    // Next we normalize the $data
    return Util.mapPromise(data, (doc, index) => {
      if (Array.isArray(data)) paths = paths.concat(index);
      if (target === 'input') doc = merge(allFields, doc);
      else if (target === 'where') doc = merge(instructFields, doc);

      return Util.pipeline(Object.entries(doc).map(([keyPath, startValue]) => async (prev) => {
        const path = paths.concat(keyPath);
        const [name] = target === 'input' ? [keyPath] : keyPath.split('.'); // Input is the only thing that can have key.path.keys
        const field = model.fields[name];

        if (!field) return Object.assign(prev, { [keyPath]: startValue }); // "keyPath" is correct here to preserve namespace

        // Transform value
        let $value = await Util.pipeline(transformers.map(t => async (value) => {
          const v = await t({ query, path, model, field, value, startValue, resolver: this.#resolver, context: this.#context });
          return v === undefined ? value : v;
        }), startValue);

        // If it's embedded - delegate
        if (field.model && !field.isFKReference && !field.isPrimaryKey) {
          $value = await this.#normalize(query, target, field.model, $value, transformers, paths.concat(keyPath));
        }

        // Assign it back
        if (target === 'input' && $value === undefined) return prev;
        return Object.assign(prev, { [field.key]: $value });
      }), {});
    });
  }
};
