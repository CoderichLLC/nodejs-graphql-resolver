const QueryResolver = require('./QueryResolver');

module.exports = class QueryResolverTransaction extends QueryResolver {
  #config;

  constructor(config) {
    super(config);
    this.#config = config;
  }

  terminate() {
    return this.#config.transaction.then((transaction) => {
      return super.terminate(super.options(transaction));
    });
  }
};
