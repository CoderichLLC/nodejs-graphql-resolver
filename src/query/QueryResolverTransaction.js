const QueryResolver = require('./QueryResolver');

module.exports = class QueryResolverTransaction extends QueryResolver {
  #config;

  constructor(config) {
    super(config);
    this.#config = config;
  }

  resolve() {
    return this.#config.transaction.then((transaction) => {
      super.options(transaction);
      return super.resolve().catch((e) => {
        return transaction.rollback().finally(() => Promise.reject(e));
      });
    });
  }
};
