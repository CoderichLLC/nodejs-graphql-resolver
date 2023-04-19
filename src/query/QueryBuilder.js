module.exports = class QueryBuilder {
  #query = Object.defineProperties({
    flags: {},
  }, {
    id: { writable: true, enumerable: false },
  });

  constructor(query = {}) {
    Object.assign(this.#query, query);
    this.sortBy = this.sort;
    this.opts = this.options;
  }

  id(id) {
    this.#propCheck('id', 'where', 'sort', 'skip', 'limit', 'before', 'after', 'first', 'last');
    this.#query.id = id;
    this.#query.where = { id };
    return this;
  }

  where(clause) {
    this.#propCheck('where', 'id');
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
    this.isCursorPaging = true;
    this.#query.before = before;
    return this;
  }

  after(after) {
    this.#propCheck('after', 'id');
    this.isCursorPaging = true;
    this.#query.after = after;
    return this;
  }

  sort(sort) {
    this.#propCheck('sort', 'id');
    this.#query.sort = sort;
    return this;
  }

  flags(flags) {
    Object.assign(this.#query.flags, flags);
    return this;
  }

  one(flags) {
    return this.flags(flags).resolve(Object.assign(this.#query, { op: 'findOne', crud: 'read' }));
  }

  many() {
    return this.resolve(Object.assign(this.#query, { op: 'findMany', crud: 'read' }));
  }

  count() {
    return this.resolve(Object.assign(this.#query, { op: 'count', crud: 'read' }));
  }

  first(first) {
    this.#propCheck('first', 'id', 'last');
    this.isCursorPaging = true;
    this.#query.first = first + 2; // Adding 2 for pagination meta info (hasNext hasPrev)
    return this;
  }

  last(last) {
    this.#propCheck('last', 'id', 'first');
    this.isCursorPaging = true;
    this.#query.last = last + 2; // Adding 2 for pagination meta info (hasNext hasPrev)
    return this;
  }

  save(...args) {
    const { id, where } = this.#query;
    const crud = (id || where ? (args[1] ? 'upsert' : 'update') : 'create'); // eslint-disable-line
    return this.#mutation(crud, ...args);
  }

  delete(...args) {
    const { id, where } = this.#query;
    if (!id && !where) throw new Error('Delete requires id() or where()');
    return this.#mutation('delete', ...args);
  }

  clone(query = {}) {
    return new QueryBuilder({ ...this.#query, ...query });
  }

  resolve() {
    return this.#query;
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
    if (['skip', 'limit'].includes(prop) && this.isCursorPaging) throw new Error(`Cannot use "${prop}" while using Cursor-Style Pagination`);
    if (['first', 'last', 'before', 'after'].includes(prop) && this.isClassicPaging) throw new Error(`Cannot use "${prop}" while using Classic-Style Pagination`);
    checks.forEach((check) => { if (this.#query[check]) throw new Error(`Cannot use "${prop}" while using "${check}"`); });
  }
};
