const API = jest.requireActual('../Emitter');
const { mergeDeep } = require('../../service/AppService');

const { emit } = API;

API.emit = (eventName, data) => {
  if (API.cloneData) data = { ...data, query: mergeDeep({}, data.query) };
  return emit.call(API, eventName, data);
};

module.exports = API;
