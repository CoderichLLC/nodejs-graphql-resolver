const Query = require('./Query');

module.exports = class QueryBuilder {
  #config;
  #schema;
  #query;

  constructor(config) {
    const { query, schema } = config;

    this.#config = config;
    this.#schema = schema;

    this.#query = Object.defineProperties(query, {
      id: { writable: true, enumerable: true, value: query.id },
      flags: { writable: true, enumerable: true, value: query.flags || {} },
      options: { writable: true, enumerable: true, value: query.options || {} },
    });

    // Aliases
    this.opts = this.options;
    this.sortBy = this.sort;
    this.remove = this.delete;
  }

  id(id) {
    this.#propCheck('id', 'where', 'native', 'sort', 'skip', 'limit', 'before', 'after', 'first', 'last');
    this.#query.id = id;
    this.#query.where = { id };
    return this;
  }

  native(clause) {
    this.#propCheck('native', 'id', 'where');
    this.#query.isNative = true;
    this.#query.where = clause;
    return this;
  }

  where(clause) {
    this.#propCheck('where', 'id', 'native');
    this.#query.where = clause;
    return this;
  }

  select(...select) {
    this.#propCheck('select');
    this.#query.select = select.flat();
    return this;
  }

  skip(skip) {
    this.#propCheck('skip', 'id');
    this.isClassicPaging = true;
    this.#query.skip = skip;
    return this;
  }

  limit(limit) {
    this.#propCheck('limit', 'id');
    this.isClassicPaging = true;
    this.#query.limit = limit;
    return this;
  }

  before(before) {
    this.#propCheck('before', 'id');
    this.#query.isCursorPaging = true;
    this.#query.before = before;
    return this;
  }

  after(after) {
    this.#propCheck('after', 'id');
    this.#query.isCursorPaging = true;
    this.#query.after = after;
    return this;
  }

  sort(sort) {
    this.#propCheck('sort', 'id');
    this.#query.sort = sort;
    return this;
  }

  options(options) {
    Object.assign(this.#query.options, options);
    return this;
  }

  flags(flags) {
    Object.assign(this.#query.flags, flags);
    return this;
  }

  one(flags) {
    return this.flags(flags).resolve(Object.assign(this.#query, { op: 'findOne', crud: 'read' }));
  }

  many(flags) {
    return this.flags(flags).resolve(Object.assign(this.#query, { op: 'findMany', crud: 'read' }));
  }

  count() {
    return this.resolve(Object.assign(this.#query, { op: 'count', crud: 'read' }));
  }

  first(first) {
    this.#propCheck('first', 'id', 'last');
    this.#query.isCursorPaging = true;
    this.#query.first = first + 2; // Adding 2 for pagination meta info (hasNext hasPrev)
    return this.resolve(Object.assign(this.#query, { op: 'findMany', crud: 'read' }));
  }

  last(last) {
    this.#propCheck('last', 'id', 'first');
    this.#query.isCursorPaging = true;
    this.#query.last = last + 2; // Adding 2 for pagination meta info (hasNext hasPrev)
    return this.resolve(Object.assign(this.#query, { op: 'findMany', crud: 'read' }));
  }

  save(...args) {
    const { id, where } = this.#query;
    const crud = (id || where ? (args[1] ? 'upsert' : 'update') : 'create'); // eslint-disable-line
    return this.#mutation(crud, ...args);
  }

  push(path, ...values) {
    values = values.flat();
    return this.#mutation('push', { [path]: values });
  }

  pull(path, ...values) {
    values = values.flat();
    return this.#mutation('pull', { [path]: values });
  }

  splice(path, ...values) {
    values = values.flat();
    return this.#mutation('splice', { [path]: values });
  }

  delete(...args) {
    const { id, where } = this.#query;
    if (!id && !where) throw new Error('Delete requires id() or where()');
    return this.#mutation('delete', ...args);
  }

  resolve() {
    return new Query(this.#config);
  }

  #mutation(crud, ...args) {
    args = args.flat();
    const { id, limit } = this.#query;
    const suffix = id || limit === 1 || (crud === 'create' && args.length < 2) ? 'One' : 'Many';
    let input = suffix === 'One' ? args[0] : args;
    if (input === undefined) input = {};
    return this.resolve(Object.assign(this.#query, { op: `${crud}${suffix}`, crud, input }));
  }

  #propCheck(prop, ...checks) {
    if (['skip', 'limit'].includes(prop) && this.#query.isCursorPaging) throw new Error(`Cannot use "${prop}" while using Cursor-Style Pagination`);
    if (['first', 'last', 'before', 'after'].includes(prop) && this.isClassicPaging) throw new Error(`Cannot use "${prop}" while using Classic-Style Pagination`);
    checks.forEach((check) => { if (this.#query[check]) throw new Error(`Cannot use "${prop}" while using "${check}"`); });
  }
};
