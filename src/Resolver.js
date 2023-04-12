const Query = require('./Query');

module.exports = class Resolver {
  #schema;
  #drivers;

  constructor(config) {
    const { schema, drivers } = config;
    this.#schema = schema;
  }

  match(model) {
    return new Query({ resolver: this, schema: this.#schema, model });
  }

  resolve(query) {
    return { schema: this.#schema, query };
  }
};
