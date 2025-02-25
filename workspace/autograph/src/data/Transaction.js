const QueryResolverTransaction = require('../query/QueryResolverTransaction');

module.exports = class Transaction {
  #schema;
  #context;
  #resolver;
  #sourceMap;
  #queries = [];

  constructor(config) {
    this.#schema = config.schema;
    this.#context = config.context;
    this.#resolver = config.resolver;
    this.#sourceMap = new Map();
  }

  match(model) {
    const { source: { client, supports } } = this.#schema.models[model];

    // Save client transaction
    if (!this.#sourceMap.has(client)) {
      this.#sourceMap.set(client, supports.includes('transactions') ? client.transaction() : Promise.resolve({
        commit: () => null,
        rollback: () => null,
      }));
    }

    this.#queries.push(new QueryResolverTransaction({
      resolver: this.#resolver,
      schema: this.#schema,
      context: this.#context,
      transaction: this.#sourceMap.get(client),
      query: { model: `${model}` },
    }));

    return this.#queries.at(-1);
  }

  commit() {
    return this.#close('commit');
  }

  rollback() {
    return this.#close('rollback');
  }

  #close(op) {
    // return Promise.all(this.#queries.map(q => q.promise())).finally(() => {
    return Promise.all(Array.from(this.#sourceMap.entries()).map(([client, promise]) => {
      return promise.then(transaction => transaction[op]());
    }));
    // });
  }
};
