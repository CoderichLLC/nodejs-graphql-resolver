const QueryBuilder = require('../../src/query/QueryBuilder');

describe('QueryBuilder', () => {
  let schema, factory;

  beforeAll(() => {
    ({ schema } = global);
    factory = model => new QueryBuilder({ schema, query: { model } });
  });

  describe('Invalid Combinations', () => {
    test('reuse', () => {
      ['id', 'where', 'native', 'select', 'sort', 'skip', 'limit', 'before', 'after'].forEach((prop) => {
        expect(() => factory('Person')[prop]({})[prop]({})).toThrow(new RegExp(`Cannot redefine "${prop}"`, 'gi'));
      });
    });

    test('paginators', () => {
      ['skip', 'limit', 'before', 'after', 'sort'].forEach((prop) => {
        expect(() => factory('Person').id(1)[prop]({})).toThrow(new RegExp(`Cannot use "${prop}" while using "id"`, 'gi'));
      });
    });

    test('id', () => {
      expect(() => factory('Person').id(1).where({})).toThrow(/Cannot redefine "where"/gi); // .id() defines a where clause
      ['native', 'sort', 'skip', 'limit', 'before', 'after'].forEach((prop) => {
        expect(() => factory('Person').id(1)[prop]({})).toThrow(new RegExp(`Cannot use "${prop}" while using "id"`, 'gi'));
      });
    });

    test('where', () => {
      ['id', 'native'].forEach((prop) => {
        expect(() => factory('Person').where(1)[prop]({})).toThrow(new RegExp(`Cannot use "${prop}" while using "where"`, 'gi'));
      });
    });

    test('native', () => {
      expect(() => factory('Person').native(1).id(1)).toThrow(/Cannot use "id" while using "where"/gi); // .native() defines a where clause
      expect(() => factory('Person').native(1).where(1)).toThrow(/Cannot redefine "where"/gi); // .native() defines a where clause
    });
  });
});
