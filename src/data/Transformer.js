const Util = require('@coderich/util');

// { query, path: path.concat(key), context: this.#context }

module.exports = class Transformer {
  #config = {
    args: {},
    shape: {},
    defaults: {},
    operation: 'set',
  };

  #operations = {
    get: {
      get: () => {

      },
    },
    set: {
      set: (target, prop, startValue) => {
        const transforms = this.#config.shape[prop] ?? [];

        const result = transforms.reduce((value, t) => {
          if (typeof t === 'function') return Util.uvl(t({ startValue, value, ...this.#config.args }), value);
          prop = t;
          return value;
        }, startValue);

        target[prop] = result;
        return true;
      },
    },
  };

  #operation;

  /**
   * Allowing construction of object before knowing full configuration
   */
  constructor(config = {}) {
    this.config(config);
  }

  /**
   * Re-assign configuration after instantiation
   */
  config(config = {}) {
    Object.assign(this.#config, config);
    this.#operation = this.#operations[this.#config.operation];
    return this;
  }

  /**
   * Re-assign args after instantiation
   */
  args(args = {}) {
    Object.assign(this.#config.args, args);
    return this;
  }

  transform(mixed, args) {
    this.args(args);
    return Util.map(mixed, data => Object.assign(new Proxy({}, this.#operation), this.#config.defaults, data));
  }
};
