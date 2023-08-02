const Util = require('@coderich/util');
// const QueryResolverTransaction = require('../query/QueryResolver');
const QueryResolverTransaction = require('../query/QueryResolverTransaction');

module.exports = class Transaction {
  #schema;
  #context;
  #resolver;
  #sourceMap;

  constructor(config) {
    this.#schema = config.schema;
    this.#context = config.context;
    this.#resolver = config.resolver;
    this.#sourceMap = new Map();
  }

  match(model) {
    const { source: { client } } = this.#schema.models[model];
    if (!this.#sourceMap.has(client)) this.#sourceMap.set(client, []);
    return Util.push(this.#sourceMap.get(client), new QueryResolverTransaction({
      resolver: this.#resolver,
      schema: this.#schema,
      context: this.#context,
      query: { model: `${model}` },
    }));
  }

  /**
   * Executes all queries in the transaction but does not commit or rollback
   */
  exec() {
    return Promise.all(Array.from(this.#sourceMap.entries()).map(([client, queries]) => {
      // return Promise.all(queries.map(query => ))
      return client.transaction(queries);
    }));
  }

  /**
   * Calls exec() and auto commit/rollback
   */
  run() {
    return this.exec();
  }
};
