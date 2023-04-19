const { isGlob } = require('../../src/service/service');

describe('service', () => {
  test('isGlob', () => {
    expect(isGlob('4?')).toBe(true);
  });
});
