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
    this.#query = query;
  }

  clone(query) {
    query = { ...this.#query, ...query }; // NO deepMerge here; must replace fields entirely
    return new Query({ ...this.#config, query });
  }

  toObject() {
    return this.#query;
  }

  toCacheKey() {
    return {
      op: this.#query.op,
      where: this.#query.where,
      sort: this.#query.sort,
      joins: this.#query.joins,
      skip: this.#query.skip,
      limit: this.#query.limit,
      before: this.#query.before,
      after: this.#query.after,
      first: this.#query.first,
      last: this.#query.last,
    };
  }

  /**
   * Run a portion of the pipeline against a data set
   */
  pipeline(target, data, transformers) {
    data = Util.unflatten(data);
    const crudMap = { create: ['$construct'], update: ['$restruct'], delete: ['$destruct'] };
    const crudLines = crudMap[this.#query.crud] || [];
    const transformerMap = {
      input: ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', ...crudLines, '$serialize', '$transform'],
      where: ['castValue', '$instruct', '$serialize'],
      sort: ['castValue'],
    };
    transformers = transformers || transformerMap[target];

    return this.#pipeline(this.#query, target, this.#model, data, transformers.map(el => Pipeline[el]));
  }

  /**
   * Transform entire query via pipeline
   */
  transform() {
    return Promise.all([
      this.pipeline('input', this.#query.input),
      this.#query.isNative ? this.#query.where : this.pipeline('where', this.#query.where),
      this.pipeline('sort', this.#query.sort),
    ]).then(([input, where, sort]) => this.clone({ input, where, sort }));
  }

  /**
   * Transform entire query for driver
   */
  toDriver() {
    const { input, where, sort, before, after, isNative, isCursorPaging } = this.#query;

    const query = this.clone({
      select: Object.values(this.#model.fields).map(field => field.key),
      input: this.#model.walk(input, node => Object.assign(node, { key: node.field.key })),
      where: isNative ? where : this.#model.walk(where, node => Object.assign(node, { key: node.field.key })),
      sort: this.#model.walk(sort, node => Object.assign(node, { key: node.field.key })),
      before: (!isCursorPaging || !before) ? undefined : JSON.parse(Buffer.from(before, 'base64').toString('ascii')),
      after: (!isCursorPaging || !after) ? undefined : JSON.parse(Buffer.from(after, 'base64').toString('ascii')),
      $schema: this.#schema.resolvePath,
    });

    if (!isNative) this.#finalize(query.toObject());

    return query;
  }

  /**
   * Recursive pipeline function
   */
  #pipeline(query, target, model, data, transformers = [], paths = []) {
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
          $value = await this.#pipeline(query, target, field.model, $value, transformers, paths.concat(key));
        }

        // Assign it back
        if (target === 'input' && $value === undefined) return prev;
        return Object.assign(prev, { [field.name]: $value });
      }), {});
    });
  }

  /**
   * Finalize the query for the driver
   */
  #finalize(query) {
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
  }
};
