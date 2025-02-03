const Util = require('@coderich/util');
const { isGlob, globToRegex, mergeDeep, JSONParse, withResolvers } = require('../service/AppService');

module.exports = class Query {
  #config;
  #resolver;
  #context;
  #schema;
  #model;
  #query;
  #resolution;

  constructor(config) {
    const { schema, context, resolver, query, resolution = withResolvers() } = config;
    this.#config = config;
    this.#resolver = resolver;
    this.#context = context;
    this.#schema = schema;
    this.#model = schema.models[query.model];
    this.#query = query;
    this.#resolution = resolution;
  }

  promise() {
    return this.#resolution.promise;
  }

  resolve() {
    this.#resolution.resolve();
  }

  clone(query) {
    query = { ...this.#query, ...query }; // NO deepMerge here; must replace fields entirely
    return new Query({ ...this.#config, query, resolution: this.#resolution });
  }

  toObject() {
    return this.#query;
  }

  toCacheKey() {
    return JSON.stringify({
      op: this.#query.op,
      select: this.#query.select,
      where: this.#query.where,
      sort: this.#query.sort,
      joins: this.#query.joins,
      skip: this.#query.skip,
      limit: this.#query.limit,
      before: this.#query.before,
      after: this.#query.after,
      first: this.#query.first,
      last: this.#query.last,
    });
  }

  /**
   * Transform entire query for user consumption
   */
  transform(asClone = true) {
    let { input, where, sort } = this.#query;
    const args = { query: this.#query, resolver: this.#resolver, context: this.#context };

    if (['create', 'update'].includes(this.#query.crud)) input = this.#model.transformers[this.#query.crud]?.transform(Util.unflatten(this.#query.input, { safe: true }), args);
    if (!this.#query.isNative && ['read', 'update', 'delete'].includes(this.#query.crud)) where = this.#model.transformers.where.transform(Util.unflatten(this.#query.where ?? {}, { safe: true }), args);
    if (['read'].includes(this.#query.crud)) sort = this.#model.transformers.sort.transform(Util.unflatten(this.#query.sort, { safe: true }), args);

    if (asClone) return this.clone({ input, where, sort });
    this.#query.input = input;
    this.#query.where = where;
    this.#query.sort = sort;
    return this;
  }

  validate() {
    const args = { query: this.#query, resolver: this.#resolver, context: this.#context };
    this.#query.input = this.#model.transformers.validate.transform(this.#query.input, args);
    return this;
  }

  /**
   * Transform entire query for driver
   */
  toDriver() {
    const { crud, input, where, sort, before, after, isNative, isCursorPaging } = this.#query;
    let $input = this.#model.transformers.toDriver.transform(input);
    if (crud === 'update') $input = Util.flatten($input, { safe: true, ignorePaths: this.#model.ignorePaths });

    const query = this.clone({
      model: this.#model.key,
      select: this.#query.select.map(name => this.#model.fields[name].key),
      input: $input,
      where: isNative ? where : this.#model.walk(where, node => Object.assign(node, { key: node.field.key })),
      sort: this.#model.walk(sort, node => Object.assign(node, { key: node.field.key })),
      before: (!isCursorPaging || !before) ? undefined : JSONParse(Buffer.from(before, 'base64').toString('ascii')),
      after: (!isCursorPaging || !after) ? undefined : JSONParse(Buffer.from(after, 'base64').toString('ascii')),
      $schema: this.#schema.resolvePath,
    });

    if (!isNative) this.#finalize(query.toObject());

    return query;
  }

  /**
   * Finalize the query for the driver
   */
  #finalize(query) {
    const { where = {}, sort = {}, op } = query;
    const flatSort = Util.flatten(sort, { safe: true });
    const flatWhere = Util.flatten(where, { safe: true });
    const $sort = Util.unflatten(Object.keys(flatSort).reduce((prev, key) => Object.assign(prev, { [key]: {} }), {}), { safe: true });

    //
    query.sort = this.#model.walk(sort, (node) => {
      if (node.field.isVirtual || node.field.isFKReference) node.key = `join_${node.field.model.key}`;
      return node;
    }, { key: 'key' });

    // Reconstruct the where clause by pulling out anything that requires a join
    query.where = Object.entries(flatWhere).reduce((prev, [key, value]) => {
      if (this.#model.isJoinPath(key, 'key')) return prev;
      value = Util.map(value, el => (isGlob(el) ? globToRegex(el) : el));
      return Object.assign(prev, { [key]: value });
    }, {});

    // Determine what join data is needed (derived from where + sort)
    const joinData = mergeDeep($sort, Util.unflatten(Object.entries(flatWhere).reduce((prev, [key, value]) => {
      if (this.#model.isJoinPath(key, 'key')) return Object.assign(prev, { [key]: value });
      return prev;
    }, {}), { safe: true }));

    // If we have 1 field in where clause this is a candidate for batching
    query.batch = (op === 'findOne' || op === 'findMany') && Object.keys(query.where).length === 1 ? Object.keys(query.where)[0] : '__default__';

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
            return prev.concat($field.linkField.key);
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
