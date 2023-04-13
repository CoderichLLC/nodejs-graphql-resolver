const { MongoClient } = require('mongodb');

module.exports = class MongClient {
  #mongoClient;
  #connection;

  constructor(config = {}) {
    const { uri } = config;
    const options = { useNewUrlParser: true, useUnifiedTopology: true, ignoreUndefined: false };
    this.#mongoClient = new MongoClient(uri, options);
    this.#connection = this.#mongoClient.connect();
  }

  resolve(query) {
    return this[query.op](query);
  }

  findOne(query) {
    return this.collection(query.model).findOne(query.where);
  }

  findMany(query) {
    return this.collection(query.model).find(query.where).then(cursor => cursor.toArray());
  }

  createOne(query) {
    return this.collection(query.model).insertOne(query.input).then(result => ({ ...query.input, _id: result.insertedId }));
  }

  collection(name) {
    return new Proxy(this.#connection, {
      get(target, method) {
        return (...args) => target.then(client => client.db().collection(name)[method](...args));
      },
    });
  }

  disconnect() {
    return this.#connection.then(client => client.close());
  }
};
