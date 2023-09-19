const API = jest.requireActual('../Emitter');
const { mergeDeep } = require('../../service/AppService');

const { emit } = API;

API.emit = (eventName, data) => {
  return emit.call(API, eventName, API.cloneData ? mergeDeep({}, data) : data);
};

module.exports = API;
