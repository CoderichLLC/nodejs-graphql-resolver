const get = require('lodash.get');
const merge = require('lodash.merge');
const Util = require('@coderich/util');
const Pipeline = require('../data/Pipeline');
const { isPlainObject, isGlob, globToRegex, mergeDeep, visitModel } = require('../service/AppService');

module.exports = class Query {
  #config;
  #resolver;
  #context;
  #schema;
  #model;
  #query;

  constructor(config) {
    const { schema, context, resolver, query } = config;
    this.#config = config;
    this.#resolver = resolver;
    this.#context = context;
    this.#schema = schema;
    this.#model = schema.models[query.model];
    this.#query = Object.defineProperties(query, {
      $clone: { value: (...args) => this.clone(...args).#query },
      $toDriver: { value: q => this.toDriver(q) },
    });
  }

  get(...args) {
    return get(this.#query, ...args);
  }

  clone(query) {
    query = merge({}, this.#query, query);
    return new Query({ ...this.#config, query });
  }

  async toObject() {
    const query = this.#query;
    const clone = this.clone().#query;
    const { crud, input, where, sort } = query;
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[crud] || [];

    [clone.input, clone.where, clone.sort] = await Promise.all([
      this.transform(query, 'input', this.#model, Util.unflatten(input), ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$serialize', '$transform', '$validate'].map(el => Pipeline[el])),
      this.transform(query, 'where', this.#model, Util.unflatten(where), ['castValue', '$instruct', '$serialize'].map(el => Pipeline[el])),
      this.transform(query, 'sort', this.#model, Util.unflatten(sort), ['castValue'].map(el => Pipeline[el])),
    ]);

    return clone;
  }

  toDriver(query) {
    return this.finalize(Object.defineProperties(query.$clone(), {
      select: {
        value: Object.values(this.#model.fields).map(field => field.name),
      },
      sort: {
        value: visitModel(this.#model, query.sort, data => Object.assign(data, { key: data.field.key })),
      },
      input: {
        value: visitModel(this.#model, query.input, data => Object.assign(data, { key: data.field.key })),
      },
      where: {
        value: visitModel(this.#model, query.where, data => Object.assign(data, { key: data.field.key })),
      },
      before: {
        get: () => {
          if (!query.isCursorPaging || !query.before) return undefined;
          return JSON.parse(Buffer.from(query.before, 'base64').toString('ascii'));
        },
      },
      after: {
        get: () => {
          if (!query.isCursorPaging || !query.after) return undefined;
          return JSON.parse(Buffer.from(query.after, 'base64').toString('ascii'));
        },
      },
      $schema: {
        value: this.#schema.resolvePath,
      },
    }));
  }

  async transform(query, target, model, data, transformers = [], paths = []) {
    const allFields = Object.values(model.fields).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const instructFields = Object.values(model.fields).filter(field => field.pipelines?.instruct).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});

    // Next we transform the $data
    return Util.mapPromise(data, (doc, index) => {
      if (Array.isArray(data)) paths = paths.concat(index);
      if (target === 'input') doc = mergeDeep(allFields, doc);
      else if (target === 'where') doc = mergeDeep(instructFields, doc);

      return Util.pipeline(Object.entries(doc).map(([key, startValue]) => async (prev) => {
        const field = model.fields[key];
        if (!field) return prev;

        // Transform value
        let $value = await Util.pipeline(transformers.map(t => async (value) => {
          const v = await t({ query, path: paths.concat(key), model, field, value, startValue, resolver: this.#resolver, context: this.#context });
          return v === undefined ? value : v;
        }), startValue);

        // If it's embedded - delegate
        if (field.model && !field.isFKReference && !field.isPrimaryKey) {
          $value = await this.transform(query, target, field.model, $value, transformers, paths.concat(key));
        }

        // Assign it back
        if (target === 'input' && $value === undefined) return prev;
        return Object.assign(prev, { [field.name]: $value });
      }), {});
    });
  }

  finalize(query) {
    const self = this;
    const { where = {}, sort = {} } = query;
    const flatSort = Util.flatten(sort, { safe: true });
    const $sort = Util.unflatten(Object.keys(flatSort).reduce((prev, key) => Object.assign(prev, { [key]: {} }), {}));
    const $target = mergeDeep($sort, where);

    [query.joins, query.where] = (function traverse($model, target, joins, clause) {
      visitModel($model, target, ({ field, key, value }) => {
        const join = { ...field.join, where: {} };

        if (field.isVirtual || (field.join && isPlainObject(value))) {
          if (field.isVirtual && !isPlainObject(value)) value = { [join.from]: value };
          joins.push(join);
          [, join.where] = traverse(field.model, value, joins, join.where);
        } else {
          value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
          clause[key] = value;
        }
      }, 'key');

      return [joins, self.#finalizeWhereClause(clause)];
    }(this.#model, $target, [], {}));

    return query;
  }

  #finalizeWhereClause(obj, arrayOp = '$in') {
    return Object.entries(Util.flatten(obj, { safe: true })).reduce((prev, [key, value]) => {
      const isArray = Array.isArray(value);
      if (isArray) return Object.assign(prev, { [key]: { [arrayOp]: value } });
      return Object.assign(prev, { [key]: value });
    }, {});
  }
};
