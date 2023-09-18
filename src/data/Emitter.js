const EventEmitter = require('events');
const Util = require('@coderich/util');
const { AbortEarlyError } = require('../service/ErrorService');

// const abortCheck = (result) => {
//   if (result !== undefined) throw new AbortEarlyError(result);
// };

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
      const numArgs = (wrapper.listener || wrapper).length;
      return prev[numArgs < 2 ? 0 : 1].push(wrapper) && prev;
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
  onKeys(eventName, keys, listener) {
    const numArgs = listener.length;

    return this.on(eventName, (event, next) => {
      if (Util.ensureArray(keys).indexOf(event.query.key) > -1) {
        const val = listener(event, next);
        if (numArgs < 2) next(val);
      } else {
        next();
      }
    });
  }

  /**
   * Syntactic sugar to listen once on query keys
   */
  onceKeys(eventName, keys, listener) {
    const numArgs = listener.length;

    const wrapper = (event, next) => {
      if (Util.ensureArray(keys).indexOf(event.query.key) > -1) {
        this.removeListener(eventName, wrapper);
        const val = listener(event, next);
        if (numArgs < 2) next(val);
      } else {
        next();
      }
    };

    return this.on(eventName, wrapper);
  }

  /**
   * Syntactic sugar to listen on query models
   */
  onModels(eventName, models, listener) {
    const numArgs = listener.length;

    return this.on(eventName, (event, next) => {
      if (Util.ensureArray(models).indexOf(`${event.query.model}`) > -1) {
        const val = listener(event, next);
        if (numArgs < 2) next(val);
      } else {
        next();
      }
    });
  }

  /**
   * Syntactic sugar to listen once on query models
   */
  onceModels(eventName, models, listener) {
    const numArgs = listener.length;

    const wrapper = (event, next) => {
      if (Util.ensureArray(models).indexOf(`${event.query.model}`) > -1) {
        this.removeListener(eventName, wrapper);
        const val = listener(event, next);
        if (numArgs < 2) next(val);
      } else {
        next();
      }
    };

    return this.on(eventName, wrapper);
  }
}

module.exports = new Emitter().setMaxListeners(100);
