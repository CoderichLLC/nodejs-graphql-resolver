const ObjectId = require('bson-objectid');
const QueryBuilder = require('../../src/query/QueryBuilder');

describe('Query', () => {
  let schema, factory, resolver;

  beforeAll(() => {
    ({ schema, resolver } = global);
    factory = model => new QueryBuilder({ resolver, schema, query: { model }, context: { network: { id: 'network' } } });
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
          id: expect.thunk(ObjectId.isValid),
          network: 'network',
        },
        args: {
          id: 1,
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
      expect((await factory('Person').where({ name: 'rich' }).save({ name: 'RiChArD', emailAddress: 'rich@gmail.com' }).transform()).toObject()).toMatchObject({
        // id: undefined,
        crud: 'update',
        op: 'updateMany',
        key: 'updatePerson',
        model: 'Person',
        input: [
          expect.objectContaining({
            id: expect.thunk(ObjectId.isValid),
            name: 'richard',
            network: 'network',
            emailAddress: 'rich@gmail.com',
            updatedAt: expect.any(Date),
            createdAt: expect.any(Date),
            // telephone: undefined, // Update does not set input as default
          }),
        ],
      });
    });

    test('create', async () => {
      expect((await factory('Person').save({ name: 'RiChArD', emailAddress: 'rich@gmail.com' }).transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'create',
        op: 'createOne',
        key: 'createPerson',
        model: 'Person',
        input: {
          id: expect.thunk(ObjectId.isValid),
          name: 'richard',
          network: 'network',
          telephone: '###-###-####', // Create will set default input
          updatedAt: expect.any(Date),
          createdAt: expect.any(Date),
        },
      });
    });
  });
});
