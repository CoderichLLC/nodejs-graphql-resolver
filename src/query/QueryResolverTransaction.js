const QueryResolver = require('./QueryResolver');

module.exports = class QueryResolverTransaction extends QueryResolver {
  #config;

  constructor(config) {
    super(config);
    this.#config = config;
  }

  resolve() {
    return this.#config.transaction.then((transaction) => {
      return super.resolve(super.options(transaction)).catch((e) => {
        transaction.rollback();
        throw e;
      });
    });
  }
};
