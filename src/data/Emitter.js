const EventEmitter = require('events');
const Util = require('@coderich/util');

/**
 * EventEmitter.
 *
 * The difference is that I'm looking at each raw listeners to determine how many arguments it's expecting.
 * If it expects more than 1 we block and wait for it to finish.
 */
class Emitter extends EventEmitter {
  emit(event, data) {
    return Promise.all(this.rawListeners(event).map((wrapper) => {
      return new Promise((resolve, reject) => {
        const next = result => resolve(result); // If a result is passed this will bypass middleware thunk()
        const numArgs = (wrapper.listener || wrapper).length;
        Promise.resolve(wrapper(data, next)).catch(e => reject(e));
        if (numArgs < 2) next();
      });
    })).then((results) => {
      return results.find(r => r !== undefined); // There can be only one (result)
    });
  }

  /**
   * Syntactic sugar to listen on keys
   */
  onKeys(on, keys, fn) {
    const numArgs = fn.length;

    return super.on(on, async (event, next) => {
      if (Util.ensureArray(keys).indexOf(event.query.key) > -1) {
        if (numArgs < 2) next();
        await fn(event, next);
      } else {
        next();
      }
    });
  }

  /**
   * Syntactic sugar to listen once keys
   */
  onceKeys(once, keys, fn) {
    const numArgs = fn.length;

    return super.once(once, async (event, next) => {
      if (Util.ensureArray(keys).indexOf(event.query.key) > -1) {
        if (numArgs < 2) next();
        await fn(event, next);
      } else {
        next();
      }
    });
  }

  /**
   * Syntactic sugar to listen on models
   */
  onModels(on, models, fn) {
    const numArgs = fn.length;

    return super.on(on, async (event, next) => {
      if (Util.ensureArray(models).indexOf(`${event.query.model}`) > -1) {
        if (numArgs < 2) next();
        await fn(event, next);
      } else {
        next();
      }
    });
  }

  /**
   * Syntactic sugar to listen once models
   */
  onceModels(once, models, fn) {
    const numArgs = fn.length;

    return super.once(once, async (event, next) => {
      if (Util.ensureArray(models).indexOf(`${event.query.model}`) > -1) {
        if (numArgs < 2) next();
        await fn(event, next);
      } else {
        next();
      }
    });
  }
}

module.exports = new Emitter().setMaxListeners(100);
