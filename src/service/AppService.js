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

exports.reduceModel = (model, fieldMap, fn, prop = 'name') => {
  if (!exports.isPlainObject(fieldMap)) return fieldMap;

  return Object.entries(fieldMap).reduce((prev, [key, value]) => {
    // Find the field; remove it if not found
    const field = Object.values(model.fields).find(el => el[prop] === key);
    if (!field) return prev;

    // Reduce value by invoking callback function
    const data = fn({ model, field, key, value });
    if (!data) return prev;

    const $value = field.model && exports.isBasicObject(data.value) ? Util.map(data.value, el => exports.reduceModel(field.model, el, fn, prop)) : data.value;
    return Object.assign(prev, { [data.key]: $value });
  }, {});
};
