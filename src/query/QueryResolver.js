const get = require('lodash.get');
// const merge = require('lodash.merge');
const Util = require('@coderich/util');
const QueryBuilder = require('./QueryBuilder');
const Pipeline = require('../data/Pipeline');
const { isPlainObject, isGlob, globToRegex, mergeDeep: merge } = require('../service/AppService');

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

  #get(query) {
    return this.#resolver.match(this.#model.name).where(query.where).one({ required: true });
  }

  async resolve() {
    const q = super.resolve();
    const query = q.$clone();
    const { where, select = Object.values(this.#model.fields).map(field => field.name) } = query;
    // const crudLines = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] }[crud] || [];

    // Normalize
    [query.input, query.where, query.select] = await Promise.all([
      Promise.resolve(Util.unflatten(query.input)),
      this.#normalize(query, 'where', this.#model, Util.unflatten(where), ['castValue', '$instruct', '$serialize'].map(el => Pipeline[el])),
      this.#normalize(query, 'select', this.#model, Util.unflatten(select.reduce((prev, field) => Object.assign(prev, { [field]: true }), {}))),
    ]);

    // Finalize query
    this.prepare(query);

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
          query.merged = query.input;
          query.input = query.merged = await this.#normalize(query, 'input', this.#model, merge({}, doc, query.input), ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', '$restruct', '$serialize', '$transform', '$validate'].map(el => Pipeline[el]));
          return this.#resolver.resolve(query);
        });
      }
      case 'pushOne': {
        return this.#get(query).then(async (doc) => {
          const [[key, values]] = Object.entries(query.input);
          const input = { [key]: (get(doc, key) || []).concat(...values) };
          return this.#resolver.match(q.model).id(q.id).save(input);
        });
      }
      case 'pullOne': {
        return this.#get(query).then(async (doc) => {
          const [[key, values]] = Object.entries(query.input);
          const input = { [key]: (get(doc, key) || []).filter(el => values.every(v => `${v}` !== `${el}`)) };
          return this.#resolver.match(q.model).id(q.id).save(input);
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
          return Promise.all(docs.map(doc => this.#resolver.match(q.model).id(doc.id).delete()));
        });
      }
      default: {
        throw new Error(`Unknown operation "${query.op}"`);
      }
    }
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

  prepare(query) {
    const self = this;
    const { model, where = {} } = query;

    [query.joins, query.where] = (function traverse($model, target, joins, clause) {
      Object.entries(target).forEach(([key, value]) => {
        const $field = $model.fields[key];
        // const isSelfReference = $field?.model?.name === model && $model.name !== model;
        // const from = isSelfReference ? $model.fields[$model.idField].key : $field?.join?.from;
        const join = { ...$field?.join, where: {} };

        if ($field?.join && isPlainObject(value)) {
          joins.push(join);
          traverse($field.model, value, joins, join.where);
        } else {
          value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
          clause[key] = value;
        }
      });

      return [joins, QueryResolver.globToRegex(clause)];
    }(self.#schema.models[model], where, [], {}));

    return query;
  }

  static globToRegex(obj, arrayOp = '$in') {
    return Object.entries(Util.flatten(obj, false)).reduce((prev, [key, value]) => {
      // value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
      if (Array.isArray(value)) return Object.assign(prev, { [key]: { [arrayOp]: value } });
      return Object.assign(prev, { [key]: value });
    }, {});
  }
};
