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
        this.#resolver.transaction(false);
        return Promise.all(input.map(el => this.#resolver.match(this.#model.name).save(el))).then((results) => {
          return this.#resolver.commit().then(() => results);
        }).catch((e) => {
          return this.#resolver.rollback().then(() => Promise.reject(e));
        });
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
          // return this.#resolveReferentialIntegrity($query).then(() => {
          return this.#resolver.resolve($query).then(() => doc);
          // });
        });
      }
      case 'deleteMany': {
        return this.#find($query).then((docs) => {
          // const txn = this.#resolver.transaction();
          return Promise.all(docs.map(doc => this.#resolver.match(this.#model.name).id(doc.id).delete()));
        });
      }
      default: {
        throw new Error(`Unknown operation "${operation}"`);
      }
    }
  }

  #resolveReferentialIntegrity(query) {
    const { id, transaction } = query;
    const txn = this.#resolver.transaction(transaction);

    return new Promise((resolve, reject) => {
      try {
        this.#model.referentialIntegrity.forEach(({ model, field, fieldRef, isArray, op }) => {
          const fieldStr = fieldRef ? `${field}.${fieldRef}` : `${field.name}`;
          const $where = { [fieldStr]: id };

          console.log(model.name, op, $where);

          switch (op) {
            case 'cascade': {
              if (isArray) {
                txn.match(model).flags({ debug: true }).where($where).pull(fieldStr, id);
              } else {
                txn.match(model).flags({ debug: true }).where($where).remove();
              }
              break;
            }
            case 'nullify': {
              txn.match(model).where($where).save({ [fieldStr]: null });
              break;
            }
            case 'restrict': {
              txn.match(model).flags({ debug: true }).where($where).count().then(count => (count ? reject(new Error('Restricted')) : count));
              break;
            }
            case 'defer': {
              // Defer to the embedded object
              // Marks the field as an onDelete candidate otherwise it (and the embedded object) will get skipped
              break;
            }
            default: throw new Error(`Unknown onDelete operator: '${op}'`);
          }
        });

        // Execute the transaction
        txn.run().then(results => resolve(results)).catch(e => reject(e));
      } catch (e) {
        txn.rollback().then(() => reject(e)).catch(err => reject(err));
      }
    });
  }
};
