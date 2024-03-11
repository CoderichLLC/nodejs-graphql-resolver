const Util = require('@coderich/util');

module.exports = class Transformer {
  #config;
  #operation;
  #operations = {
    get: {
      get: () => {

      },
    },
    set: {
      set: (target, prop, value) => {
        const transforms = this.#config.shape[prop] ?? [];
        const $value = transforms.reduce((prev, t) => {
          if (typeof t === 'function') return t(prev);
          prop = t;
          return prev;
        }, value);
        target[prop] = $value;
        return true;
      },
    },
  };

  constructor(config = {}) {
    this.#config = config;
    this.#config.shape ??= {};
    this.#config.defaults ??= {};
    this.#config.operation ??= 'set';
    this.#operation = this.#operations[this.#config.operation];
  }

  transform(mixed) {
    return Util.map(mixed, data => Object.assign(new Proxy({}, this.#operation), this.#config.defaults, data));
  }
};
