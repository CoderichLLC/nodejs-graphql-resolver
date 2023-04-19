const Util = require('@coderich/util');

exports.isGlob = str => /\*|\?|\[.+\]/.test(str);

exports.globToRegex = (mixed) => {
  return Util.map(mixed, (glob) => {
    const escapedGlob = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexPattern = escapedGlob.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
    return new RegExp(`^${regexPattern}$`, 'i');
  });
};

exports.resolveWhereClause = (clause = {}, arrayOp = '$in') => {
  return Object.entries(clause).reduce((prev, [key, value]) => {
    // if (exports.isGlob(value)) console.log(key, value, exports.globToRegex(value));
    value = exports.isGlob(value) ? exports.globToRegex(value) : value;
    if (Array.isArray(value)) return Object.assign(prev, { [key]: { $in: value } });
    return Object.assign(prev, { [key]: value });
  }, {});
};
