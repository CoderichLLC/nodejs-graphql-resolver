const get = require('lodash.get');
const Util = require('@coderich/util');
const QueryBuilder = require('./QueryBuilder');
const { mergeDeep, withResolvers } = require('../service/AppService');

module.exports = class QueryResolver extends QueryBuilder {
  #model;
  #schema;
  #config;
  #context;
  #resolver;
  #resolution = withResolvers(); // Promise for when the query is resolved

  constructor(config) {
    const { schema, context, resolver, query } = config;
    super(config);
    this.#config = config;
    this.#schema = schema;
    this.#context = context;
    this.#resolver = resolver;
    this.#model = schema.models[query.model];
  }

  promise() {
    return this.#resolution.promise;
  }

  terminate() {
    const query = super.terminate();
    query.promise().then(this.#resolution.resolve).catch(this.#resolution.reject);
    const { op, args: { input } } = query.toObject();

    // Resolve
    switch (op) {
      case 'findOne': case 'findMany': case 'count': case 'createOne': {
        return this.#resolver.resolve(query);
      }
      case 'createMany': {
        return this.#resolver.transaction(false).run(Promise.all(input.map(el => this.#resolver.match(this.#model.name).save(el))));
      }
      case 'updateOne': {
        return this.#get(query).then((doc) => {
          const merged = mergeDeep({}, doc, Util.unflatten(input, { safe: true })); // This is for backwards compat
          return this.#resolver.resolve(query.clone({ doc, input: merged }));
        });
      }
      case 'updateMany': {
        return this.#find(query).then((docs) => {
          return this.#resolver.transaction(false).run(Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).save(input))));
        });
      }
      case 'pushOne': {
        return this.#get(query).then((doc) => {
          const [key] = Object.keys(input);
          const $query = Object.assign(query.toObject(), { doc });
          const args = { query: $query, resolver: this.#resolver, context: this.#context };
          const values = get(this.#model.transformers.create.transform(input, args), key);
          const $input = { [key]: (get(doc, key) || []).concat(...values) };
          return this.#resolver.match(this.#model.name).id(doc.id).save($input);
        });
      }
      case 'pushMany': {
        const [[key, values]] = Object.entries(input);
        return this.#find(query).then((docs) => {
          return this.#resolver.transaction(false).run(Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).push(key, values))));
        });
      }
      case 'pullOne': {
        return this.#get(query).then((doc) => {
          const [key] = Object.keys(input);
          const $query = Object.assign(query.toObject(), { doc });
          const args = { query: $query, resolver: this.#resolver, context: this.#context };
          const values = get(this.#model.transformers.create.transform(input, args), key, []);
          const $doc = Util.pathmap(key, doc, (arr) => {
            if (arr == null) return arr;
            return arr.filter(el => values.every(v => `${v}` !== `${el}`));
          });
          return this.#resolver.match(this.#model.name).id(doc.id).save({ [key]: get($doc, key) });
        });
      }
      case 'pullMany': {
        const [[key, values]] = Object.entries(input);
        return this.#find(query).then((docs) => {
          return this.#resolver.transaction(false).run(Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).pull(key, values))));
        });
      }
      case 'spliceOne': {
        return this.#get(query).then((doc) => {
          const [key] = Object.keys(input);
          const $query = Object.assign(query.toObject(), { doc });
          const args = { query: $query, resolver: this.#resolver, context: this.#context };
          const [find, replace] = get(this.#model.transformers.create.transform(input, args), key);
          const $input = { [key]: (get(doc, key) || []).map(el => (`${el}` === `${find}` ? replace : el)) };
          return this.#resolver.match(this.#model.name).id(doc.id).save($input);
        });
      }
      case 'deleteOne': {
        return this.#get(query).then((doc) => {
          return this.#resolveReferentialIntegrity(doc).then(() => {
            return this.#resolver.resolve(query.clone({ doc })).then(() => doc);
          });
        });
      }
      case 'deleteMany': {
        return this.#find(query).then((docs) => {
          return this.#resolver.transaction(false).run(Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).delete())));
        });
      }
      default: {
        return Promise.reject(new Error(`Unknown operation "${op}"`));
      }
    }
  }

  #get(query) {
    return this.#resolver.match(this.#model.name).id(query.toObject().id).one({ required: true });
  }

  #find(query) {
    return this.#resolver.resolve(query.clone({ op: 'findMany', key: `find${this.#model.name}`, crud: 'read', isMutation: false }));
  }

  #resolveReferentialIntegrity(doc) {
    const txn = this.#resolver.transaction(false);

    return txn.run(Util.promiseChain(this.#model.referentialIntegrity.map(({ model, field, path }) => () => {
      const { onDelete, isArray, fkField } = field;
      const id = doc[fkField];
      const $path = path.join('.');
      const where = field.isVirtual ? { [field.model.pkField]: get(doc, field.linkBy) } : { [$path]: id };

      switch (onDelete) {
        case 'cascade': return isArray ? txn.match(model).where(where).pull($path, id) : txn.match(model).where(where).remove();
        case 'nullify': return txn.match(model).where(where).save({ [$path]: null });
        case 'restrict': return txn.match(model).where(where).count().then(count => (count ? Promise.reject(new Error('Restricted')) : count));
        case 'defer': return Promise.resolve(); // Used for embedded models (could be improved)
        default: throw new Error(`Unknown onDelete operator: '${onDelete}'`);
      }
    })));
  }
};
