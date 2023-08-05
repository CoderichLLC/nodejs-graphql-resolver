const { query1, query2 } = require('./service');
const { isGlob, hashObject } = require('../../src/service/AppService');

describe('service', () => {
  test('isGlob', () => {
    expect(isGlob('4?')).toBe(true);
  });

  test('hashObject', () => {
    expect(hashObject(query1)).toEqual(hashObject(query2));
  });
});
