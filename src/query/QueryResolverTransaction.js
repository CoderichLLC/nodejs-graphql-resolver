const Util = require('@coderich/util');
const QueryResolver = require('./QueryResolver');

module.exports = class QueryResolverTransaction extends QueryResolver {
  #config;

  constructor(config) {
    super(config);
    this.#config = config;
  }

  resolve() {
    return this.#config.transaction.then((transaction) => {
      return Util.timeout(0).then(() => super.resolve(super.options(transaction)));
    });
  }
};
