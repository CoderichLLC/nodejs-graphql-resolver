const Util = require('@coderich/util');
const PicoMatch = require('picomatch');
const FillRange = require('fill-range');
const ObjectHash = require('object-hash');
const ObjectId = require('bson-objectid');
const DeepMerge = require('deepmerge');

exports.isGlob = str => PicoMatch.scan(str).isGlob;
exports.globToRegex = (glob, options = {}) => PicoMatch.makeRe(glob, { nocase: true, ...options, expandRange: (a, b) => `(${FillRange(a, b, { toRegex: true })})` });

const smartMerge = (target, source, options) => source;
exports.isScalarValue = value => typeof value !== 'object' && typeof value !== 'function';
exports.isLeafValue = value => Array.isArray(value) || value instanceof Date || ObjectId.isValid(value) || exports.isScalarValue(value);
exports.isBasicObject = obj => obj != null && typeof obj === 'object' && !(ObjectId.isValid(obj)) && !(obj instanceof Date) && typeof (obj.then) !== 'function';
exports.isPlainObject = obj => exports.isBasicObject(obj) && !Array.isArray(obj);
exports.mergeDeep = (...args) => DeepMerge.all(args, { isMergeableObject: obj => (exports.isPlainObject(obj) || Array.isArray(obj)), arrayMerge: smartMerge });
exports.hashObject = obj => ObjectHash(obj, { respectType: false, respectFunctionNames: false, respectFunctionProperties: false, unorderedArrays: true, ignoreUnknown: true, replacer: r => (ObjectId.isValid(r) ? `${r}` : r) });

exports.finalizeWhereClause = (obj, arrayOp = '$in') => {
  return Object.entries(Util.flatten(obj, { safe: true })).reduce((prev, [key, value]) => {
    const isArray = Array.isArray(value);
    if (isArray) return Object.assign(prev, { [key]: { [arrayOp]: value } });
    return Object.assign(prev, { [key]: value });
  }, {});
};
