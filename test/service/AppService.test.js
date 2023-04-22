const { ObjectId } = require('mongodb');
const { isGlob } = require('../../src/service/AppService');

describe('service', () => {
  test('isGlob', () => {
    expect(isGlob('4?')).toBe(true);
  });

  test('ObjectId', () => {
    console.log(new ObjectId({ some: 'object' }));
  });
});
