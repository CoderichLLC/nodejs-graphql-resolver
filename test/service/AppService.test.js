const { isGlob } = require('../../src/service/AppService');

describe('service', () => {
  test('isGlob', () => {
    expect(isGlob('4?')).toBe(true);
  });
});
