const Query = require('./Query');

module.exports = class Resolver {
  #config;

  constructor(config) {
    this.#config = config;
  }

  match(model) {
    return new Query({ resolver: this, schema: this.#config.schema, query: { model } });
  }

  query(query) {
    return this.resolve(query.resolve());
  }

  resolve(query) {
    return query;
  }
};
