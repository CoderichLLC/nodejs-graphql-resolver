const Util = require('@coderich/util');
const Pipeline = require('./Pipeline');
const QueryBuilder = require('./QueryBuilder');

module.exports = class QueryResolver extends QueryBuilder {
  #model;
  #schema;
  #hydrate;
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
    return new QueryResolver({ schema: this.#schema, resolver: this.#resolver, query });
  }

  resolve() {
    const query = super.resolve();
    const { where, input, select = Object.values(this.#model.fields).map(field => field.name) } = query;
    const defaultInput = Object.values(this.#model.fields).filter(field => Object.prototype.hasOwnProperty.call(field, 'defaultValue')).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});
    const instructFields = Object.values(this.#model.fields).filter(field => field.pipelines?.instruct).reduce((prev, field) => Object.assign(prev, { [field.name]: undefined }), {});

    const $input = { ...defaultInput, ...input, ...instructFields };
    const $where = { ...where, instructFields };
    const $select = select.reduce((prev, field) => Object.assign(prev, { [field]: true }), {});
    query.input = this.#normalize($input, ['defaultValue', 'castValue', 'ensureArrayValue', '$normalize', '$instruct', '$transform'].map(el => Pipeline[el]), false);
    query.where = this.#normalize($where, ['castValue', '$instruct'].map(el => Pipeline[el]));
    query.select = this.#normalize($select);
    return this.#resolver.resolve(query);
  }

  #normalize(data, transformers = [], unflatten = true) {
    if (typeof data !== 'object') return data;
    if (unflatten) data = Util.unflatten(data);

    // For now...
    const context = { network: { id: 'networkId' } };

    // Next we normalize the $data
    data = Object.entries(Util.flatten(data, false)).reduce((prev, [key, startValue]) => {
      let [$key] = key.split('.');
      const model = this.#model;
      const field = model.fields[$key];
      if (!field) return Object.assign(prev, { [key]: startValue }); // "key" is correct here to preserve namespace
      $key = field.key || key;

      // Transform value
      const $value = transformers.reduce((value, t) => {
        const v = t({ model, field, value, startValue, context });
        // const v = t({ base, model, field, path, docPath, rootPath, parentPath, startValue, value, resolver, context });
        return v === undefined ? value : v;
      }, startValue);

      // Assign it back
      return Object.assign(prev, { [$key]: $value });
    }, {});

    // Unflatten it back
    return Util.unflatten(data, false);
  }
};
