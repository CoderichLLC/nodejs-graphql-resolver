const get = require('lodash.get');
const merge = require('lodash.merge');
const Util = require('@coderich/util');
const Pipeline = require('../data/Pipeline');
const { isPlainObject, isBasicObject, isGlob, globToRegex, mergeDeep } = require('../service/AppService');

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
    query = merge({}, this.#config.query, query);
    // query = { ...this.#config.query, ...query };
    return new Query({ ...this.#config, query });
  }

  async toObject() {
    const query = this.#query;
    const clone = this.clone().#query;
    const { crud, input, where } = query;
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[crud] || [];

    [clone.input, clone.where] = await Promise.all([
      this.transform(query, 'input', this.#model, Util.unflatten(input), ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$serialize', '$transform', '$validate'].map(el => Pipeline[el])),
      this.transform(query, 'where', this.#model, Util.unflatten(where), ['castValue', '$instruct', '$serialize'].map(el => Pipeline[el])),
    ]);

    return clone;
  }

  toDriver(query) {
    const clone = query.$clone();

    const $clone = Object.defineProperties(clone, {
      select: {
        value: Object.values(this.#model.fields).map(field => field.name),
      },
      input: {
        value: this.finalize(this.#model, query.input),
      },
      where: {
        value: this.finalize(this.#model, query.where),
      },
      // where: {
      //   value: Object.entries(Util.flatten(this.finalize(this.#model, query.where), { safe: true })).reduce((prev, [key, value]) => {
      //     value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
      //     value = Array.isArray(value) ? { $in: value } : value;
      //     return Object.assign(prev, { [key]: value });
      //   }, {}),
      // },
      // joins: {
      //   value: Object.values(this.#model.fields).map(field => field.name),
      // },
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
    });

    return this.prepare($clone);
  }

  async transform(query, target, model, data, transformers = [], paths = []) {
    const allFields = Object.values(model.fields).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const instructFields = Object.values(model.fields).filter(field => field.pipelines?.instruct).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});

    // Next we transform the $data
    return Util.mapPromise(data, (doc, index) => {
      if (Array.isArray(data)) paths = paths.concat(index);
      if (target === 'input') doc = mergeDeep(allFields, doc);
      else if (target === 'where') doc = mergeDeep(instructFields, doc);

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
          $value = await this.transform(query, target, field.model, $value, transformers, paths.concat(keyPath));
        }

        // Assign it back
        if (target === 'input' && $value === undefined) return prev;
        return Object.assign(prev, { [field.name]: $value });
      }), {});
    });
  }

  finalize(model, fields = {}) {
    if (!isPlainObject(fields)) return fields;

    return Object.entries(fields).reduce((prev, [name, value]) => {
      const field = model.fields[name];
      if (!field) return prev;
      if (field.model && isBasicObject(value)) value = Util.map(value, val => this.finalize(field.model, val));
      return Object.assign(prev, { [field.key]: value });
    }, {});
  }

  prepare(query) {
    const self = this;
    const { model, where = {} } = query;

    [query.joins, query.where] = (function traverse($model, target, joins, clause) {
      Object.entries(target).forEach(([name, value]) => {
        const $field = $model.fields[name];
        const join = { ...$field?.join, where: {} };

        if ($field?.isVirtual || ($field?.join && isPlainObject(value))) {
        // if ($field?.join) {
          // const isSelfReference = $field.model.name === model && $model.name !== model;
          // const from = isSelfReference ? $model.fields[$model.idField].key : $field.join.from;
          if ($field.isVirtual && !isPlainObject(value)) value = { [join.from]: value };
          joins.push(join);
          [, join.where] = traverse($field.model, value, joins, join.where);
        } else {
          value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
          clause[name] = value;
        }
      });

      return [joins, self.#globToRegex(clause)];
    }(self.#schema.models[model], where, [], {}));

    return query;
  }

  #globToRegex(obj, arrayOp = '$in') {
    return Object.entries(Util.flatten(obj, { safe: true })).reduce((prev, [key, value]) => {
      const isArray = Array.isArray(value);
      if (isArray) return Object.assign(prev, { [key]: { [arrayOp]: value } });
      return Object.assign(prev, { [key]: value });
    }, {});
  }
};
