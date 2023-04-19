const Util = require('@coderich/util');

exports.isGlob = (str) => {
  if (typeof str !== 'string') return false;
  // if (/^[a-fA-F0-9]{24}$/.test(str)) return false; // Exclude any string of 24 characters that contains only hexadecimal characters
  return /\*|\?|\[.+\]/.test(str);
};

exports.globToRegex = (mixed) => {
  return Util.map(mixed, (value) => {
    try {
      if (!exports.isGlob(value)) return value;
      const escapedGlob = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regexPattern = escapedGlob.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
      return new RegExp(`^${regexPattern}$`, 'i');
    } catch (e) {
      console.log(value);
      throw e;
    }
  });
};

exports.resolveWhereClause = (clause = {}, arrayOp = '$in') => {
  return Object.entries(clause).reduce((prev, [key, value]) => {
    value = exports.globToRegex(value);
    if (Array.isArray(value)) return Object.assign(prev, { [key]: { [arrayOp]: value } });
    return Object.assign(prev, { [key]: value });
  }, {});
};
