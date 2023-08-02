const QueryResolver = require('./QueryResolver');

/**
 * Extended class in order to defer execution until the very end
 */
module.exports = class QueryResolverTransaction extends QueryResolver {
  resolve() {
    return this;
  }

  exec(options) {
    super.options(options);
    return super.resolve();
  }
};
