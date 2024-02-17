const EventEmitter = require('events');
const Util = require('@coderich/util');
const { AbortEarlyError } = require('../service/ErrorService');

/**
 * EventEmitter.
 *
 * The difference is that I'm looking at each raw listeners to determine how many arguments it's expecting.
 * If it expects more than 1 we block and wait for it to finish.
 */
class Emitter extends EventEmitter {
  emit(event, data) {
    // Here we pull out functions with "next" vs those without
    const [basicFuncs, nextFuncs] = this.rawListeners(event).reduce((prev, wrapper) => {
      const listener = wrapper.listener || wrapper;
      const isBasic = listener.length < 2;
      return prev[isBasic ? 0 : 1].push(wrapper) && prev;
    }, [[], []]);

    return new Promise((resolve, reject) => {
      // Basic functions run first; if they return a value they abort the flow of execution
      basicFuncs.forEach((fn) => {
        const value = fn(data);
        if (value !== undefined && !(value instanceof Promise)) throw new AbortEarlyError(value);
      });

      // Next functions are async and control the timing of the next phase
      Promise.all(nextFuncs.map((fn) => {
        return new Promise((next) => {
          Promise.resolve(fn(data, next));
        }).then((result) => {
          if (result !== undefined) throw new AbortEarlyError(result);
        }).catch(reject);
      })).then(() => resolve()); // Resolve to undefined
    }).catch((e) => {
      if (e instanceof AbortEarlyError) return e.data;
      throw e;
    });
  }

  /**
   * Syntactic sugar to listen on query keys
   */
  onKeys(...args) {
    return this.#createWrapper(...args, 'key');
  }

  /**
   * Syntactic sugar to listen once on query keys
   */
  onceKeys(...args) {
    return this.#createWrapper(...args, 'key', true);
  }

  /**
   * Syntactic sugar to listen on query models
   */
  onModels(...args) {
    return this.#createWrapper(...args, 'model');
  }

  /**
   * Syntactic sugar to listen once on query models
   */
  onceModels(...args) {
    return this.#createWrapper(...args, 'model', true);
  }

  #createWrapper(eventName, arr, listener, prop, once) {
    arr = Util.ensureArray(arr);

    const wrapper = listener.length < 2 ? (event) => {
      if (arr.includes(`${event.query[prop]}`)) {
        if (once) this.removeListener(eventName, wrapper);
        return listener(event);
      }
      return undefined;
    } : (event, next) => {
      if (arr.includes(`${event.query[prop]}`)) {
        if (once) this.removeListener(eventName, wrapper);
        return next(listener(event, next));
      }
      return next();
    };

    return this.on(eventName, wrapper);
  }
}

module.exports = new Emitter().setMaxListeners(100);
