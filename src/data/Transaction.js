const Util = require('@coderich/util');
const QueryResolver = require('../query/QueryResolver');

/**
 * Extended class in order to defer execution until the very end
 */
class QueryResolverTransaction extends QueryResolver {
  resolve() { return this; }
  exec() { return super.resolve(); }
}

module.exports = class Transaction {
  #schema;
  #context;
  #resolver;
  #queries;

  constructor(config) {
    this.#queries = [];
    this.#schema = config.schema;
    this.#context = config.context;
    this.#resolver = config.resolver;
  }

  match(model) {
    return Util.push(this.#queries, new QueryResolverTransaction({
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
    return Promise.all(this.#queries.map(q => q.exec()));
  }

  /**
   * Calls exec() and auto commit/rollback
   */
  run() {
    return this.exec();
  }
};
