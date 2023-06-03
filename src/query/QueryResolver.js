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
    return this.#resolver.match(this.#model.name).where(query.get('where')).one({ required: true });
  }

  #find($query) {
    return this.#resolver.resolve($query.$clone({ op: 'findMany' }));
  }

  async resolve() {
    const query = super.resolve();
    const $query = await query.toObject();
    const [operation, input] = [query.get('op'), query.get('input')];

    // Resolve
    switch (operation) {
      case 'findOne': case 'findMany': case 'count': {
        return this.#resolver.resolve($query);
      }
      case 'createOne': {
        return this.#resolver.resolve($query);
      }
      case 'createMany': {
        return Promise.all(input.map(el => this.#resolver.match(this.#model.name).save(el)));
      }
      case 'updateOne': {
        return this.#get(query).then(async (doc) => {
          const merged = mergeDeep({}, Util.unflatten(doc), Util.unflatten(input));
          const $clone = await query.clone({ input: merged, doc, merged }).toObject();
          return this.#resolver.resolve($clone);
        });
      }
      case 'updateMany': {
        return this.#find($query).then((docs) => {
          return Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).save(input)));
        });
      }
      case 'pushOne': {
        return this.#get(query).then(async (doc) => {
          const [key] = Object.keys(input);
          const values = get($query.input, key);
          const $input = { [key]: (get(doc, key) || []).concat(...values) };
          return this.#resolver.match(this.#model.name).id(doc.id).save($input);
        });
      }
      case 'pushMany': {
        const [[key, values]] = Object.entries(input[0]);
        return this.#find($query).then((docs) => {
          return Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).push(key, values)));
        });
      }
      case 'pullOne': {
        return this.#get(query).then(async (doc) => {
          const [key] = Object.keys(input);
          const values = get($query.input, key);
          const $input = { [key]: (get(doc, key) || []).filter(el => values.every(v => `${v}` !== `${el}`)) };
          return this.#resolver.match(this.#model.name).id(doc.id).save($input);
        });
      }
      case 'pullMany': {
        const [[key, values]] = Object.entries(input[0]);
        return this.#find($query).then((docs) => {
          return Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).pull(key, values)));
        });
      }
      case 'spliceOne': {
        return this.#get(query).then(async (doc) => {
          const [key] = Object.keys(input);
          const [find, replace] = get($query.input, key);
          const $input = { [key]: (get(doc, key) || []).map(el => (`${el}` === `${find}` ? replace : el)) };
          return this.#resolver.match(this.#model.name).id(doc.id).save($input);
        });
      }
      case 'deleteOne': {
        return this.#get(query).then((doc) => {
          $query.doc = doc;
          return this.#resolver.resolve($query).then(() => doc);
        });
      }
      case 'deleteMany': {
        return this.#find($query).then((docs) => {
          return Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).delete()));
        });
      }
      default: {
        throw new Error(`Unknown operation "${operation}"`);
      }
    }
  }
};
