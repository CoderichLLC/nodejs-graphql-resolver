const Boom = require('@hapi/boom');
const get = require('lodash.get');
const Util = require('@coderich/util');
const uniqWith = require('lodash.uniqwith');
const { hashObject } = require('../service/AppService');

module.exports = class Pipeline {
  constructor() {
    throw new Error('Pipeline is a singleton; use the static {define|factory} methods');
  }

  static define(name, factory, options = {}) {
    // A factory must be a function
    if (typeof factory !== 'function') throw new Error(`Pipeline definition for "${name}" must be a function`);

    // Determine options; which may come from the factory function
    const { ignoreNull = true, itemize = true, configurable = false } = { ...factory.options, ...options };

    const wrapper = Object.defineProperty((args) => {
      // if (name === 'immutable') console.log(name, args);

      if (ignoreNull && args.value == null) return args.value;

      if (ignoreNull && itemize) {
        return Util.map(args.value, (val, index) => {
          const v = factory({ ...args, value: val });
          return v === undefined ? val : v;
        });
      }

      const val = factory(args);
      return val === undefined ? args.value : val;
    }, 'name', { value: name });

    // Attach enumerable method to the Pipeline
    return Object.defineProperty(Pipeline, name, {
      value: wrapper,
      configurable,
      enumerable: true,
    })[name];
  }

  static factory(name, thunk, options = {}) {
    if (typeof thunk !== 'function') throw new Error(`Pipeline factory for "${name}" must be a thunk`);
    if (typeof thunk() !== 'function') throw new Error(`Factory thunk() for "${name}" must return a function`);
    return Object.defineProperty(Pipeline, name, { value: (...args) => Object.defineProperty(thunk(...args), 'options', { value: options }) })[name];
  }

  static createPresets() {
    // Built-In Javascript String Transformers
    const jsStringTransformers = ['toLowerCase', 'toUpperCase', 'toString', 'trim', 'trimEnd', 'trimStart'];
    jsStringTransformers.forEach(name => Pipeline.define(`${name}`, ({ value }) => String(value)[name]()));

    // Additional Transformers
    Pipeline.define('toTitleCase', ({ value }) => value.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
    Pipeline.define('toSentenceCase', ({ value }) => value.charAt(0).toUpperCase() + value.slice(1));
    // Pipeline.define('toId', ({ model, value }) => model.idValue(value));
    Pipeline.define('toArray', ({ value }) => (Array.isArray(value) ? value : [value]), { itemize: false });
    Pipeline.define('toDate', ({ value }) => new Date(value), { configurable: true });
    Pipeline.define('timestamp', ({ value }) => Date.now(), { ignoreNull: false });
    Pipeline.define('createdAt', ({ value }) => value || Date.now(), { ignoreNull: false });
    Pipeline.define('dedupe', ({ value }) => uniqWith(value, (b, c) => hashObject(b) === hashObject(c)), { itemize: false });
    Pipeline.define('ensureArrayValue', ({ field, value }) => (field.isArray && !Array.isArray(value) ? [value] : value), { itemize: false });
    Pipeline.define('defaultValue', ({ field: { defaultValue }, value }) => (value === undefined ? defaultValue : value), { ignoreNull: false });
    Pipeline.define('idField', ({ resolver, value }) => resolver.idValue(value.id || value));
    // Pipeline.define('idKey', ({ resolver, value }) => resolver.idValue(value), { ignoreNull: false });

    // Structures
    Pipeline.define('$instruct', params => Pipeline.#resolve(params, 'instruct'), { ignoreNull: false });
    Pipeline.define('$normalize', params => Pipeline.#resolve(params, 'normalize'), { ignoreNull: false });
    Pipeline.define('$serialize', params => Pipeline.#resolve(params, 'serialize'), { ignoreNull: false });
    Pipeline.define('$deserialize', params => Pipeline.#resolve(params, 'deserialize'), { ignoreNull: false });
    Pipeline.define('$transform', params => Pipeline.#resolve(params, 'transform'), { ignoreNull: false });
    Pipeline.define('$construct', params => Pipeline.#resolve(params, 'construct'), { ignoreNull: false });
    Pipeline.define('$restruct', params => Pipeline.#resolve(params, 'restruct'), { ignoreNull: false });
    Pipeline.define('$destruct', params => Pipeline.#resolve(params, 'destruct'), { ignoreNull: false });
    Pipeline.define('$validate', params => Pipeline.#resolve(params, 'validate'), { ignoreNull: false });

    //
    Pipeline.define('ensureId', ({ resolver, field, value }) => {
      const { type } = field;
      const ids = Util.filterBy(Util.ensureArray(value), (a, b) => `${a}` === `${b}`);
      return resolver.match(type).where({ id: ids }).count().then((count) => {
        if (count !== ids.length) throw Boom.notFound(`${type} Not Found`);
      });
    }, { itemize: false });

    //
    Pipeline.define('castValue', ({ field, value }) => {
      const { type, isEmbedded } = field;
      if (isEmbedded) return value;

      return Util.map(value, (v) => {
        switch (type.toLowerCase()) {
          case 'string': {
            return `${v}`;
          }
          case 'float': case 'number': {
            const num = Number(v);
            if (!Number.isNaN(num)) return num;
            return v;
          }
          case 'int': {
            const num = Number(v);
            if (!Number.isNaN(num)) return parseInt(v, 10);
            return v;
          }
          case 'boolean': {
            if (v === 'true') return true;
            if (v === 'false') return false;
            return v;
          }
          default: {
            return v;
          }
        }
      });
    });

    // Required fields
    Pipeline.define('required', ({ model, field, value }) => {
      if (value == null) throw Boom.badRequest(`${model.name}.${field.name} is required`);
    }, { ignoreNull: false });

    // A field cannot hold a reference to itself
    Pipeline.define('selfless', ({ query, model, field, value }) => {
      if (`${value}` === `${query.doc?.id}`) throw Boom.badRequest(`${model}.${field} cannot hold a reference to itself`);
    });

    // Once set it cannot be changed
    Pipeline.define('immutable', ({ query, model, field, value, path }) => {
      const oldVal = get(query.doc, path);
      if (oldVal !== undefined && value !== undefined && `${hashObject(oldVal)}` !== `${hashObject(value)}`) throw Boom.badRequest(`${model}.${field} is immutable; cannot be changed once set ${oldVal} -> ${value}`);
    });

    // List of allowed values
    Pipeline.factory('Allow', (...args) => function allow({ model, field, value }) {
      if (args.indexOf(value) === -1) throw Boom.badRequest(`${model}.${field} allows ${args}; found '${value}'`);
    });

    // List of disallowed values
    Pipeline.factory('Deny', (...args) => function deny({ model, field, value }) {
      if (args.indexOf(value) > -1) throw Boom.badRequest(`${model}.${field} denys ${args}; found '${value}'`);
    });

    // Min/Max range
    Pipeline.factory('Range', (min, max) => {
      if (min == null) min = undefined;
      if (max == null) max = undefined;

      return function range({ model, field, value }) {
        const num = +value; // Coerce to number if possible
        const test = Number.isNaN(num) ? value.length : num;
        if (test < min || test > max) throw Boom.badRequest(`${model}.${field} must satisfy range ${min}:${max}; found '${value}'`);
      };
    }, { itemize: false });
  }

  static #resolve(params, pipeline) {
    const transformers = params.field.pipelines?.[pipeline] || [];

    return Util.pipeline(transformers.map(t => async (value) => {
      return Pipeline[t]({ ...params, value });
    }), params.value);
  }
};

module.exports.createPresets();
