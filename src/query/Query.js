const get = require('lodash.get');
const merge = require('lodash.merge');
const Util = require('@coderich/util');
const Pipeline = require('../data/Pipeline');
const { isGlob, globToRegex, mergeDeep, finalizeWhereClause } = require('../service/AppService');

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
      $toDriver: { value: () => this.toDriver() },
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
    const query = this.clone().#query;
    const { crud, input, where, sort, isNative } = query;
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[crud] || [];

    [query.input, query.where, query.sort] = await Promise.all([
      this.transform(this.#query, 'input', this.#model, Util.unflatten(input), ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$serialize', '$transform', '$validate'].map(el => Pipeline[el])),
      isNative ? where : this.transform(this.#query, 'where', this.#model, Util.unflatten(where), ['castValue', '$instruct', '$serialize'].map(el => Pipeline[el])),
      this.transform(this.#query, 'sort', this.#model, Util.unflatten(sort), ['castValue'].map(el => Pipeline[el])),
    ]);

    // Cache key
    query.cacheKey = {
      op: query.op,
      where: query.where,
      sort: query.sort,
      joins: query.joins,
      skip: query.skip,
      limit: query.limit,
      before: query.before,
      after: query.after,
      first: query.first,
      last: query.last,
    };

    return query;
  }

  toDriver() {
    const query = this.#query;
    const { where, isNative } = query;

    const $query = Object.defineProperties(query.$clone(), {
      isNative: {
        value: isNative,
      },
      select: {
        value: Object.values(this.#model.fields).map(field => field.key),
      },
      input: {
        value: this.#model.walk(query.input, node => Object.assign(node, { key: node.field.key })),
      },
      where: {
        value: isNative ? where : this.#model.walk(query.where, node => Object.assign(node, { key: node.field.key })),
      },
      sort: {
        value: this.#model.walk(query.sort, node => Object.assign(node, { key: node.field.key })),
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
    });

    return isNative ? $query : this.finalize($query);
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
    const { where = {}, sort = {} } = query;
    const flatSort = Util.flatten(sort, { safe: true });
    const flatWhere = Util.flatten(where, { safe: true });
    const $sort = Util.unflatten(Object.keys(flatSort).reduce((prev, key) => Object.assign(prev, { [key]: {} }), {}));

    //
    query.sort = this.#model.walk(sort, (node) => {
      if (node.field.isVirtual || node.field.isFKReference) node.key = `join_${node.field.model.key}`;
      return node;
    }, { key: 'key' });

    // Reconstruct the where clause by pulling out anything that requires a join
    query.where = finalizeWhereClause(Util.unflatten(Object.entries(flatWhere).reduce((prev, [key, value]) => {
      if (this.#model.isJoinPath(key, 'key')) return prev;
      value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
      return Object.assign(prev, { [key]: value });
    }, {}), { safe: true }));

    // Determine what join data is needed (derived from where + sort)
    const joinData = mergeDeep($sort, Util.unflatten(Object.entries(flatWhere).reduce((prev, [key, value]) => {
      if (this.#model.isJoinPath(key, 'key')) return Object.assign(prev, { [key]: value });
      return prev;
    }, {}), { safe: true }));

    // Construct joins
    query.joins = [];

    this.#model.walk(joinData, (node) => {
      const { model, field, key, value, isLeaf, path, run } = node;

      if (field.join) {
        let isArray;
        const join = { ...field.join, where: {} };

        if (run.length > 1) {
          join.from = path.reduce((prev, curr, i) => {
            const $field = this.#model.resolvePath(path.slice(0, i + 1).join('.'), 'key');
            if ($field.isArray) isArray = true;
            return prev.concat($field.linkFrom);
          }, []).join('.');
        }

        join.isArray = isArray || model.resolvePath(join.from).isArray;

        query.joins.push(join);
      }

      if (isLeaf) {
        const $model = field.model || model;
        const join = query.joins.find(j => j.to === $model.key);
        const $value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
        const $$value = Array.isArray($value) ? { $in: $value } : $value;
        const from = field.model ? join.from : key;
        join.where[from] = $$value;
        return false;
      }

      return node;
    }, { key: 'key' });

    return query;
  }
};
