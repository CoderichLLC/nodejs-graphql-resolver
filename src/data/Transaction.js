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

    // Save client transaction
    if (!this.#sourceMap.has(client)) this.#sourceMap.set(client, client.transaction());

    return new QueryResolverTransaction({
      resolver: this.#resolver,
      schema: this.#schema,
      context: this.#context,
      transaction: this.#sourceMap.get(client),
      query: { model: `${model}` },
    });
  }

  commit() {
    return Promise.all(Array.from(this.#sourceMap.entries()).map(([client, transaction]) => {
      return transaction.then(({ commit }) => commit());
    }));
  }

  rollback() {
    return Promise.all(Array.from(this.#sourceMap.entries()).map(([client, transaction]) => {
      return transaction.then(({ rollback }) => rollback());
    }));
  }
};
