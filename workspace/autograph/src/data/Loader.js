const DataLoader = require('dataloader');
const { hashObject } = require('../service/AppService');

module.exports = class Loader {
  #loader;
  #resolver;

  constructor(resolver, config = {}) {
    config.cacheKeyFn ??= event => hashObject(event.args);
    this.#loader = new DataLoader(events => this.#resolve(events), config);
    this.#resolver = resolver;
  }

  load(args, context) {
    return this.#loader.load({ args, context });
  }

  prime(args, value) {
    return this.#loader.prime({ args }, value);
  }

  clear(args) {
    return this.#loader.clear({ args });
  }

  clearAll() {
    return this.#loader.clearAll();
  }

  #resolve(events) {
    return Promise.all(events.map(event => this.#resolver(event.args, event.context)));
  }
};
