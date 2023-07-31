const Util = require('@coderich/util');
const PicoMatch = require('picomatch');
const FillRange = require('fill-range');
const { ObjectId } = require('mongodb'); // eslint-disable-line
const { createHash } = require('crypto');
const DeepMerge = require('deepmerge');

exports.isGlob = str => PicoMatch.scan(str).isGlob;
exports.globToRegex = (glob, options = {}) => PicoMatch.makeRe(glob, { nocase: true, ...options, expandRange: (a, b) => `(${FillRange(a, b, { toRegex: true })})` });

exports.hashObject = (obj) => {
  const flat = obj.toHexString ? obj.toHexString() : Object.entries(Util.flatten(obj)).join('|');
  return createHash('md5').update(flat).digest('hex');
};

const smartMerge = (target, source, options) => source;
exports.isBasicObject = obj => obj != null && typeof obj === 'object' && !(ObjectId.isValid(obj)) && !(obj instanceof Date) && typeof (obj.then) !== 'function';
exports.isPlainObject = obj => exports.isBasicObject(obj) && !Array.isArray(obj);
exports.mergeDeep = (...args) => DeepMerge.all(args, { isMergeableObject: obj => (exports.isPlainObject(obj) || Array.isArray(obj)), arrayMerge: smartMerge });

/**
 * Recursively transform a data object with respect to a given model
 */
exports.visitModel = (model, data, fn, prop = 'name') => {
  if (data == null || !exports.isPlainObject(data)) return data;

  return Object.entries(data).reduce((prev, [key, value]) => {
    // Find the field; remove it if not found
    const field = Object.values(model.fields).find(el => el[prop] === key);
    if (!field) return prev;

    // Invoke callback function; allowing result to be modified in order to change key/value
    const node = fn({ model, field, key, value });
    if (!node) return prev;

    // Transform
    const $value = field.model && exports.isBasicObject(node.value) ? Util.map(node.value, el => exports.visitModel(field.model, el, fn, prop)) : node.value;
    return Object.assign(prev, { [node.key]: $value });
  }, {});
};
