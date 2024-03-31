const { query1, query2 } = require('./service');
const { isGlob, hashObject } = require('../../src/service/AppService');

describe('AppService', () => {
  test('isGlob', () => {
    expect(isGlob('4?')).toBe(true);
    expect(isGlob('!value')).toBe(true);
    expect(isGlob('TRu?')).toBe(true);
  });

  test('hashObject', () => {
    expect(hashObject(query1)).toEqual(hashObject(query2));
    expect(hashObject(1)).toEqual('1aee48a1ce9885851ed10b486ed333ee181944db');
  });
});
