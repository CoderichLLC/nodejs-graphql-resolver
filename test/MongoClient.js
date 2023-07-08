const { inspect } = require('util');
const Util = require('@coderich/util');
const { MongoClient } = require('mongodb');

const queryOptions = { collation: { locale: 'en', strength: 2 } };

module.exports = class MongoDriver {
  #mongoClient;
  #connection;

  constructor(config = {}) {
    const { uri } = config;
    const options = { useNewUrlParser: true, useUnifiedTopology: true, ignoreUndefined: false };
    this.#mongoClient = new MongoClient(uri, options);
    this.#connection = this.#mongoClient.connect();
  }

  resolve(query) {
    if (query.flags?.debug) console.log(inspect(query, { depth: null, showHidden: false, colors: true }));
    if (!this[query.op]) console.log('what', query);
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
    const $update = { $set: Util.flatten(query.input, { safe: true }) };
    return this.collection(query.model).updateOne(query.where, $update, queryOptions).then(() => query.input);
  }

  deleteOne(query) {
    return this.collection(query.model).deleteOne(query.where);
  }

  deleteMany(query) {
    return this.collection(query.model).deleteMany(query.where);
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

  driver(name) {
    return this.collection(name);
  }

  transaction(ops) {
    return Util.promiseRetry(() => {
      // Create session and start transaction
      return this.#connection.then(client => client.startSession({ readPreference: { mode: 'primary' } })).then((session) => {
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        const close = () => { session.endSession(); };

        // Execute each operation with session
        return Promise.all(ops.map(op => op.exec({ session }))).then((results) => {
          results.$commit = () => session.commitTransaction().then(close);
          results.$rollback = () => session.abortTransaction().then(close);
          return results;
        }).catch((e) => {
          close();
          throw e;
        });
      });
    }, 200, 5, e => e.errorLabels && e.errorLabels.indexOf('TransientTransactionError') > -1);
  }

  static aggregateJoin(query, join, id) {
    const { to: from, on: foreignField, from: localField, where: $match } = join;
    const as = `parent${id}`;
    const $let = { [`${as}_${localField}`]: `$${localField}` };
    const $field = query.$schema(`${from}.${localField}`);
    const op = $field.isArray ? '$in' : '$eq';
    $match.$expr = { [op]: [`$${foreignField}`, `$$${as}_${localField}`] };
    const pipeline = [{ $match }];
    // const $addFields = MongoDriver.convertFieldsForRegex(query.$schema, from, $match, true);
    // if (Object.keys($addFields).length) pipeline.unshift({ $addFields });
    return [
      {
        $lookup: {
          from,
          let: $let,
          pipeline,
          as,
        },
      },
      {
        $unwind: `$${as}`,
      },
    ];
  }

  static aggregateJoins(query, joins = []) {
    const [join, ...pipeline] = joins;
    const $aggregate = MongoDriver.aggregateJoin(query, join, 0);
    let pointer = $aggregate[0].$lookup.pipeline;

    pipeline.forEach((j, i) => {
      const $agg = MongoDriver.aggregateJoin(query, j, i + 1);
      pointer.push(...$agg);
      pointer = $agg[0].$lookup.pipeline;
    });

    return $aggregate.concat({
      $group: {
        _id: '$_id',
        data: { $first: '$$ROOT' },
        parent0: { $addToSet: '$parent0' },
      },
    }, {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ['$data', { parent0: '$parent0' }],
        },
      },
    });
  }

  static convertFieldsForSort(sort) {
    return Util.unflatten(Object.entries(Util.flatten(sort, false)).reduce((prev, [key, value]) => {
      return Object.assign(prev, { [key]: value === 'asc' ? 1 : -1 });
    }, {}), false);
  }

  static convertFieldsForRegex($schema, model, where, forceArray) {
    return Object.entries(where).reduce((prev, [key, value]) => {
      const field = $schema(`${model}.${key}`);

      if (Util.ensureArray(value).some(el => el instanceof RegExp)) {
        const conversion = forceArray || field.isArray ? { $map: { input: `$${key}`, as: 'el', in: { $toString: '$$el' } } } : { $toString: `$${key}` };
        Object.assign(prev, { [key]: conversion });
      }

      return prev;
    }, {});

    // return Util.unflatten(Object.entries(Util.flatten(where, false)).reduce((prev, [key, value]) => {
    //   const $key = key.split('.').reverse().find(k => !k.startsWith('$')).replace(/[[\]']/g, '');
    //   const field = Object.values(model.fields).find(el => el.key === $key);

    //   if (!field) console.log($key, value);

    //   if (Util.ensureArray(value).some(el => el instanceof RegExp)) {
    //     const conversion = field.isArray ? { $map: { input: `$${$key}`, as: 'el', in: { $toString: '$$el' } } } : { $toString: `$${$key}` };
    //     Object.assign(prev, { [$key]: conversion });
    //   }

    //   return prev;
    // }, {}), false);
  }

  static aggregateQuery(query, count = false) {
    const { model, where, sort = {}, skip, limit, joins, after, before, first } = query;
    const $aggregate = [{ $match: where }];
    const $addFields = MongoDriver.convertFieldsForRegex(query.$schema, model, where);
    const $sort = MongoDriver.convertFieldsForSort(sort);

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

      // Joins
      if (joins?.length) $aggregate.push(...MongoDriver.aggregateJoins(query, joins));

      // Sort, Skip, Limit documents
      if ($sort && Object.keys($sort).length) $aggregate.push({ $sort });
      if (skip) $aggregate.push({ $skip: skip });
      if (limit) $aggregate.push({ $limit: limit });

      // Pagination
      if (after) $aggregate.push({ $match: { $or: Object.entries(after).reduce((prev, [key, value]) => prev.concat({ [key]: { [$sort[key] === 1 ? '$gte' : '$lte']: value } }), []) } });
      if (before) $aggregate.push({ $match: { $or: Object.entries(before).reduce((prev, [key, value]) => prev.concat({ [key]: { [$sort[key] === 1 ? '$lte' : '$gte']: value } }), []) } });
      if (first) $aggregate.push({ $limit: first });
    }

    if (query.flags?.debug) console.log(inspect($aggregate, { depth: null, showHidden: false, colors: true }));

    return $aggregate;
  }
};
