const { inspect } = require('util');
const Util = require('@coderich/util');
const { MongoClient, ObjectId } = require('mongodb');

const queryOptions = { collation: { locale: 'en', strength: 2 } };
const ensureArray = a => (Array.isArray(a) ? a : [a].filter(el => el !== undefined));

module.exports = class MongoDriver {
  #mongoClient;
  #connection;

  constructor(config = {}) {
    const { uri } = config;
    const options = { useNewUrlParser: true, useUnifiedTopology: true, ignoreUndefined: false };
    this.#mongoClient = new MongoClient(uri, options);
    this.#connection = this.#mongoClient.connect();
  }

  // query(collection, method, ...args) {
  //   return this.collection(collection)[method](...args);
  // }

  resolve(query) {
    if (query.flags?.debug) console.log(inspect(query, { depth: null, showHidden: false, colors: true }));
    if (!this[query.op]) console.log(query);
    return this[query.op](query);
  }

  findOne(query) {
    return this.findMany(Object.assign(query, { first: 1 })).then(([doc]) => doc);
  }

  findMany(query) {
    const $aggregate = MongoDriver.aggregateQuery(query);
    return this.collection(query.model).aggregate($aggregate, queryOptions).then(cursor => cursor.toArray());
  }

  count(query) {
    const $aggregate = MongoDriver.aggregateQuery(query, true);
    return this.collection(query.model).aggregate($aggregate, queryOptions).then((cursor) => {
      return cursor.next().then((doc) => {
        return doc ? doc.count : 0;
      });
    });
  }

  createOne(query) {
    return this.collection(query.model).insertOne(query.input).then(result => ({ ...query.input, _id: result.insertedId }));
  }

  updateOne(query) {
    const $update = { $set: query.input };
    return this.collection(query.model).updateOne(query.where, $update, queryOptions).then(() => query.input);
  }

  collection(name) {
    return new Proxy(this.#connection, {
      get(target, method) {
        return (...args) => {
          return target.then(client => client.db().collection(name)[method](...args));
        };
      },
    });
  }

  disconnect() {
    return this.#connection.then(client => client.close());
  }

  idValue(value) {
    if (value instanceof ObjectId) return value;

    try {
      const id = new ObjectId(value);
      return id;
    } catch (e) {
      return value;
    }
  }

  static aggregateQuery(query, count = false) {
    const { where: $match, sort = {}, skip, limit, joins, after, before, first } = query;
    const $aggregate = [{ $match }];

    // Inspect the query
    const { $addFields } = Util.unflatten(Object.entries(Util.flatten(query.where, false)).reduce((prev, [key, value]) => {
      const $key = key.split('.').reverse().find(k => !k.startsWith('$'));

      if (ensureArray(value).some(el => el instanceof RegExp)) {
        const conversion = Array.isArray(value) ? { $map: { input: `$${$key}`, as: 'el', in: { $toString: '$$el' } } } : { $toString: `$${$key}` };
        Object.assign(prev.$addFields, { [$key]: conversion });
      }
      return prev;
    }, { $addFields: {} }), false);

    // Used for $regex matching
    if (Object.keys($addFields).length) $aggregate.unshift({ $addFields });

    if (count) {
      $aggregate.push({ $count: 'count' });
    } else {
      // // This is needed to return FK references as an array in the correct order
      // // http://www.kamsky.org/stupid-tricks-with-mongodb/using-34-aggregation-to-return-documents-in-same-order-as-in-expression
      // // https://jira.mongodb.org/browse/SERVER-7528
      // const idKey = MongoDriver.idKey();
      // const idMatch = $match[idKey];
      // if (typeof idMatch === 'object' && idMatch.$in) {
      //   $aggregate.push({ $addFields: { __order: { $indexOfArray: [idMatch.$in, `$${idKey}`] } } });
      //   $aggregate.push({ $sort: { __order: 1 } });
      // }

      // // Joins
      // if (joins) $aggregate.push(...joins.map(({ to: from, by: foreignField, from: localField, as }) => ({ $lookup: { from, foreignField, localField, as } })));

      // Sort, Skip, Limit documents
      // if (sort && Object.keys(sort).length) $aggregate.push({ $sort: toKeyObj(sort) });
      if (skip) $aggregate.push({ $skip: skip });
      if (limit) $aggregate.push({ $limit: limit });

      // Pagination
      // if (after) $aggregate.push({ $match: { $or: Object.entries(after).reduce((prev, [key, value]) => prev.concat({ [key]: { [sort[key] === 1 ? '$gte' : '$lte']: value } }), []) } });
      // if (before) $aggregate.push({ $match: { $or: Object.entries(before).reduce((prev, [key, value]) => prev.concat({ [key]: { [sort[key] === 1 ? '$lte' : '$gte']: value } }), []) } });
      if (first) $aggregate.push({ $limit: first });
    }

    if (query.flags?.debug) console.log(inspect($aggregate, { depth: null, showHidden: false, colors: true }));

    return $aggregate;
  }
};
