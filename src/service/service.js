// const Util = require('@coderich/util');

exports.isGlob = str => /\*|\?|\[.+\]/.test(str);
// exports.isGlob = str => /^\*|\?/g.test(str);

exports.globToRegex = (glob) => {
  const escapedGlob = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regexPattern = escapedGlob.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(`^${regexPattern}$`);
};

exports.resolveWhereClause = (clause = {}, arrayOp = '$in') => {
  return Object.entries(clause).reduce((prev, [key, value]) => {
    // if (exports.isGlob(value)) console.log(key, value, exports.globToRegex(value));
    value = exports.isGlob(value) ? exports.globToRegex(value) : value;
    if (Array.isArray(value)) return Object.assign(prev, { [key]: { $in: value } });
    return Object.assign(prev, { [key]: value });
  }, {});
};

// exports.normalize = () => {
//   return Util.mapPromise(data, (doc) => {
//     if (target === 'input') merge(doc, defaultInput, doc, instructFields);
//     else if (target === 'where') merge(doc, instructFields);

//     return Util.promiseChain(Object.entries(doc).map(([key, startValue]) => async (chain) => {
//       let [$key] = key.split('.');
//       const field = model.fields[$key];
//       const prev = chain.pop();
//       if (!field) return Object.assign(prev, { [key]: startValue }); // "key" is correct here to preserve namespace
//       $key = field.key || key;

//       // Transform value
//       let $value = await Util.promiseChain(transformers.map(t => async (ch) => {
//         const value = ch.pop();
//         const v = await t({ model, field, value, startValue, resolver: this.#resolver, context: this.#context });
//         return v === undefined ? value : v;
//       }), startValue).then(ch => ch.pop());

//       // If it's embedded - delegate
//       if (field.model && !field.isFKReference) {
//         $value = await this.#normalize(target, field.model, $value, transformers);
//       }

//       // Assign it back
//       return Object.assign(prev, { [$key]: $value });
//     }), {}).then(chain => chain.pop());
//   });
// };
