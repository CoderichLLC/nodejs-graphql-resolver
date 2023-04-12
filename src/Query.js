const Util = require('@coderich/util');
const BaseQuery = require('@coderich/query');

module.exports = class Query extends BaseQuery {
  #model;
  #schema;
  #resolver;
  #arrayOp;

  constructor(config) {
    const { schema, resolver, query, arrayOp = '$eq' } = config;
    super(query);
    this.#schema = schema;
    this.#resolver = resolver;
    this.#arrayOp = arrayOp;
    this.#model = schema.models[query.model];
  }

  clone(q) {
    const query = super.clone(q).resolve();
    return new Query({ schema: this.#schema, resolver: this.#resolver, query });
  }

  resolve() {
    const query = super.resolve();
    const { where, select = Object.values(this.#model.fields).map(field => field.name) } = query;
    const $select = select.reduce((prev, field) => Object.assign(prev, { [field]: true }), {});
    query.where = this.#normalize(where, this.#model.keyMap);
    query.select = this.#normalize($select, this.#model.keyMap);
    return this.#resolver.resolve(query);
  }

  #normalize(data, keyMap = {}) {
    if (typeof data !== 'object') return data;

    // Flatten (but don't spread arrays - we want to special handle them)
    const $data = Object.entries(Util.flatten(data, false)).reduce((prev, [key, value]) => {
      // Rename key
      const $key = Object.entries(keyMap).reduce((p, [k, v]) => {
        const regex = new RegExp(`((?:^|\\.))${k}\\b`, 'g');
        return p.replace(regex, `$1${v}`);
      }, key);

      // Special array handling, ensure we understand the meaning
      if (Array.isArray(value)) {
        const match = $key.match(/\$[a-zA-Z]{2}(?=']|$)/);
        const $value = value.map(el => this.#normalize(el));
        value = match ? $value : { [this.#arrayOp]: $value };
      }

      // Assign it back
      return Object.assign(prev, { [$key]: value });
    }, {});

    // Unflatten it back
    return Util.unflatten($data, false);
  }
};
