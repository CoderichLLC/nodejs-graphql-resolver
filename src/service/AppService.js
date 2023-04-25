const get = require('lodash.get');
const Util = require('@coderich/util');
const PicoMatch = require('picomatch');
const FillRange = require('fill-range');
const { ObjectId } = require('mongodb'); // eslint-disable-line
const { createHash } = require('crypto');
// const DeepMerge = require('deepmerge');

exports.isGlob = str => PicoMatch.scan(str).isGlob;
exports.globToRegex = (glob, options = {}) => PicoMatch.makeRe(glob, { nocase: true, ...options, expandRange: (a, b) => `(${FillRange(a, b, { toRegex: true })})` });

exports.hashObject = (obj) => {
  const flat = obj.toHexString ? obj.toHexString() : Object.entries(Util.flatten(obj)).join('|');
  return createHash('md5').update(flat).digest('hex');
};

// const smartMerge = (target, source, options) => source;
// exports.isBasicObject = obj => obj != null && typeof obj === 'object' && !(ObjectId.isValid(obj)) && !(obj instanceof Date) && typeof (obj.then) !== 'function';
// exports.isPlainObject = obj => exports.isBasicObject(obj) && !Array.isArray(obj);
// exports.mergeDeep = (...args) => DeepMerge.all(args, { isMergeableObject: obj => (exports.isPlainObject(obj) || Array.isArray(obj)), arrayMerge: smartMerge });

/**
 *
 */
exports.resolveWhereClause = (clause = {}, arrayOp = '$in') => {
  return Object.entries(clause).reduce((prev, [key, value]) => {
    value = Util.map(value, el => (exports.isGlob(el) ? exports.globToRegex(el) : el));
    if (Array.isArray(value)) return Object.assign(prev, { [key]: { [arrayOp]: value } });
    return Object.assign(prev, { [key]: value });
  }, {});
};

/**
 *
 */
exports.paginateResults = (rs, query) => {
  let hasNextPage = false;
  let hasPreviousPage = false;
  const { first, after, last, before, sort = {} } = query;
  const limiter = first || last;
  const sortPaths = Object.keys(Util.flatten(sort, false));

  // Add $cursor data
  Util.map(rs, (doc) => {
    const sortValues = sortPaths.reduce((prev, path) => Object.assign(prev, { [path]: get(doc, path) }), {});
    Object.defineProperty(doc, '$cursor', { value: Buffer.from(JSON.stringify(sortValues)).toString('base64') });
  });

  // First try to take off the "bookends" ($gte | $lte)
  if (rs.length && rs[0].$cursor === after) {
    rs.shift();
    hasPreviousPage = true;
  }

  if (rs.length && rs[rs.length - 1].$cursor === before) {
    rs.pop();
    hasNextPage = true;
  }

  // Next, remove any overage
  const overage = rs.length - (limiter - 2);

  if (overage > 0) {
    if (first) {
      rs.splice(-overage);
      hasNextPage = true;
    } else if (last) {
      rs.splice(0, overage);
      hasPreviousPage = true;
    } else {
      rs.splice(-overage);
      hasNextPage = true;
    }
  }

  // Add $pageInfo
  return Object.defineProperties(rs, {
    $pageInfo: {
      get() {
        return {
          startCursor: get(rs, '0.$cursor', ''),
          endCursor: get(rs, `${rs.length - 1}.$cursor`, ''),
          hasPreviousPage,
          hasNextPage,
        };
      },
    },
  });
};
