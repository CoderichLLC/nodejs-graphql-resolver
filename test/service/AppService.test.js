const ObjectId = require('bson-objectid');
const { query1, query2 } = require('./service');
const { isGlob, hashObject, detailedDiff } = require('../../src/service/AppService');

describe('AppService', () => {
  test('isGlob', () => {
    expect(isGlob('4?')).toBe(true);
  });

  test('hashObject', () => {
    expect(hashObject(query1)).toEqual(hashObject(query2));
  });

  describe('detailedDiff', () => {
    let doc = {
      id: new ObjectId('650f8a03a208dd188bc910c2'),
      sections: [{ id: 1, name: 'section1' }],
    };

    test('Array Addition', () => {
      const input = {
        id: new ObjectId('650f8a03a208dd188bc910c2'),
        sections: [
          { id: 1, name: 'section1', frozen: 'rope' },
          { id: 2, name: 'section2' },
        ],
      };

      expect(detailedDiff(doc, input)).toEqual({
        added: {
          sections: {
            1: { id: 2, name: 'section2' },
          },
        },
        updated: {},
        deleted: {},
      });

      doc = input;
    });

    test.skip('Array Subtraction', () => {
      const input = { id: 1, sections: [{ id: 2, name: 'section2' }] };
      expect(detailedDiff(doc, input)).toEqual({
        added: {},
        updated: {},
        deleted: {
          sections: {
            1: undefined,
          },
        },
      });
    });
  });
});
