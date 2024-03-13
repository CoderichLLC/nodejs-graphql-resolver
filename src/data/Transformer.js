const Util = require('@coderich/util');

module.exports = class Transformer {
  #config = { shape: {}, defaults: {}, args: {}, strictSchema: false, keepUndefined: false };

  #operation = {
    set: (target, prop, startValue) => {
      if (this.#config.shape[prop]) {
        const result = this.#config.shape[prop].reduce((value, t) => {
          if (typeof t === 'function') return Util.uvl(t({ startValue, value, ...this.#config.args }), value);
          prop = t;
          return value;
        }, startValue);

        if (result !== undefined || this.#config.keepUndefined) target[prop] = result;
      } else if (!this.#config.strictSchema) {
        target[prop] = startValue;
      }

      return true;
    },
  };

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
    return Util.map(mixed, (data) => {
      const $data = Object.assign({}, this.#config.defaults, data); // eslint-disable-line
      return Object.assign(new Proxy({}, this.#operation), $data);
    });
  }
};
