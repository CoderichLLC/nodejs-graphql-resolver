const QueryBuilder = require('../../src/query/QueryBuilder');

describe('Query', () => {
  let schema, factory;

  beforeAll(() => {
    ({ schema } = global);
    factory = model => new QueryBuilder({ schema, query: { model }, context: { network: { id: 'network' } } });
  });

  describe('transform', () => {
    test('one', async () => {
      expect((await factory('Person').id(1).one().transform()).toObject()).toMatchObject({
        id: 1,
        crud: 'read',
        op: 'findOne',
        key: 'getPerson',
        model: 'Person',
        input: undefined,
        where: {
          id: expect.anything(),
          network: 'network',
        },
      });
    });

    test('many', async () => {
      expect((await factory('Person').where({ name: 'RICH' }).sort({ age: 'desc' }).many().transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'read',
        op: 'findMany',
        key: 'findPerson',
        model: 'Person',
        input: undefined,
        where: {
          name: 'rich',
          network: 'network',
        },
        sort: {
          age: 'desc',
        },
      });
    });

    test('update', async () => {
      expect((await factory('Person').where({ name: 'rich' }).save({ name: 'RiChArD' }).transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'update',
        op: 'updateMany',
        key: 'updatePerson',
        model: 'Person',
        input: [
          expect.objectContaining({
            id: expect.anything(),
            name: 'richard',
            network: 'network',
            telephone: '###-###-####',
            updatedAt: expect.anything(),
            createdAt: expect.anything(),
          }),
        ],
      });
    });

    test('save', async () => {
      expect((await factory('Person').save({ name: 'RiChArD' }).transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'create',
        op: 'createOne',
        key: 'createPerson',
        model: 'Person',
        input: {
          id: expect.anything(),
          name: 'richard',
          network: 'network',
          telephone: '###-###-####',
          updatedAt: expect.anything(),
          createdAt: expect.anything(),
        },
      });
    });
  });
});
