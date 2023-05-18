const get = require('lodash.get');
const Util = require('@coderich/util');
const QueryBuilder = require('./QueryBuilder');
const { mergeDeep } = require('../service/AppService');

module.exports = class QueryResolver extends QueryBuilder {
  #model;
  #schema;
  #context;
  #resolver;

  constructor(config) {
    const { schema, context, resolver, query } = config;
    super(config);
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
    const query = await q.toObject();

    // Resolve
    switch (query.op) {
      case 'findOne': case 'findMany': case 'count': {
        return this.#resolver.resolve(query);
      }
      case 'createOne': case 'createMany': {
        return this.#resolver.resolve(query);
      }
      case 'updateOne': case 'updateMany': {
        return this.#get(query).then(async (doc) => {
          const merged = mergeDeep({}, Util.unflatten(doc), Util.unflatten(q.get('input')));
          const clone = await q.clone({ input: merged, doc, merged }).toObject();
          return this.#resolver.resolve(clone);
        });
      }
      case 'pushOne': {
        return this.#get(query).then(async (doc) => {
          const [key] = Object.keys(q.get('input'));
          const values = get(query.input, key);
          const input = { [key]: (get(doc, key) || []).concat(...values) };
          return this.#resolver.match(query.model).id(doc.id).save(input);
        });
      }
      case 'pullOne': {
        return this.#get(query).then(async (doc) => {
          const [key] = Object.keys(q.get('input'));
          const values = get(query.input, key);
          const input = { [key]: (get(doc, key) || []).filter(el => values.every(v => `${v}` !== `${el}`)) };
          return this.#resolver.match(query.model).id(doc.id).save(input);
        });
      }
      case 'spliceOne': {
        return this.#get(query).then(async (doc) => {
          const [key] = Object.keys(q.get('input'));
          const [find, replace] = get(query.input, key);
          const input = { [key]: (get(doc, key) || []).map(el => (`${el}` === `${find}` ? replace : el)) };
          return this.#resolver.match(query.model).id(doc.id).save(input);
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
          return Promise.all(docs.map(doc => this.#resolver.match(query.model).id(doc.id).delete()));
        });
      }
      default: {
        throw new Error(`Unknown operation "${query.op}"`);
      }
    }
  }
};
