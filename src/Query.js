const Query = require('@coderich/query');

module.exports = class extends Query {
  #schema;
  #resolver;

  constructor(config) {
    const { schema, resolver, ...query } = config;
    super(query);
    this.#schema = schema;
    this.#resolver = resolver;
  }

  resolve() {
    const query = super.resolve();
    return this.#resolver.resolve(query);
  }
};
