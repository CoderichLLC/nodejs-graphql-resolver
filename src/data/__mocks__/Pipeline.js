/**
 * We need to export Pipeline as a POJO so jest can spy on it
 * This is because all the methods are defined using Object.defineProperty
 */
const Pipeline = jest.requireActual('../Pipeline');
const Util = require('@coderich/util');

const API = {};

Pipeline.resolve = (params, pipeline) => {
  const transformers = params.field.pipelines[pipeline] || [];

  return transformers.reduce((value, t) => {
    return Util.uvl(API[t]({ ...params, value }), value);
  }, params.value);

  // return Util.pipeline(transformers.map(t => (value) => {
  //   return API[t]({ ...params, value });
  // }), params.value);
};

Object.getOwnPropertyNames(Pipeline).reduce((prev, key) => {
  return Object.assign(prev, { [key]: Pipeline[key] });
}, API);

// For those defined outside of Pipeline.js itself
API.define = (key, ...args) => {
  Pipeline.define(key, ...args);
  API[key] = Pipeline[key];
};

module.exports = API;
