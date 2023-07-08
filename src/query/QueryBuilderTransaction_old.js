const QueryBuilder = require('./QueryBuilder');

module.exports = class QueryBuilderTransaction extends QueryBuilder {
  resolve(...args) {
    return new Promise((resolve, reject) => {
      this.theCall = { args: args.flat(), resolve, reject };
    });
  }

  exec(options) {
    if (!this.theCall) return undefined;

    const { args, resolve } = this.theCall;
    // this.query.options(options);

    return super.resolve(...args).then((result) => {
      resolve(result);
      return result;
    });
  }
};
