const Util = require('@coderich/util');
const QueryResolverTransaction = require('../query/QueryResolverTransaction');

module.exports = class Transaction {
  #schema;
  #context;
  #resolver;
  #sourceMap;
  // #transaction;

  constructor(config) {
    this.#schema = config.schema;
    this.#context = config.context;
    this.#resolver = config.resolver;
    this.#sourceMap = new Map();
  }

  match(model) {
    const { source: { client } } = this.#schema.models[model];

    if (!this.#sourceMap.has(client)) {
      this.#sourceMap.set(client, {
        transaction: client.transaction(),
        queries: [],
      });
    }

    const { transaction, queries } = this.#sourceMap.get(client);

    return Util.push(queries, new QueryResolverTransaction({
      resolver: this.#resolver,
      schema: this.#schema,
      context: this.#context,
      transaction,
      query: { model: `${model}` },
    }));
  }

  commit() {
    return Promise.all(Array.from(this.#sourceMap.entries()).map(([client, { transaction }]) => {
      return transaction.then(({ commit }) => commit());
    }));
  }

  rollback() {
    return Promise.all(Array.from(this.#sourceMap.entries()).map(([client, { transaction }]) => {
      return transaction.then(({ rollback }) => rollback());
    }));
  }

  // /**
  //  * Executes all queries in the transaction but does not commit or rollback
  //  */
  // exec() {
  //   // this.#transaction = Promise.all(Array.from(this.#sourceMap.entries()).map(([client, queries]) => {
  //   //   return client.transaction(queries);
  //   // }));
  //   // return this.#transaction;
  // }

  // /**
  //  * Calls exec() and auto commit/rollback
  //  */
  // run() {
  //   return this.exec();
  // }

  // commit() {
  //   console.log('lets commit');

  //   return this.#transaction.then((rs) => {
  //     console.log(rs);
  //     return rs.$commit();
  //   });
  // }
};
