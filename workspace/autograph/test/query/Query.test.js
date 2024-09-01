const ObjectId = require('bson-objectid');
const QueryBuilder = require('../../src/query/QueryBuilder');

describe('Query', () => {
  let schema, factory, resolver;

  beforeAll(() => {
    ({ schema, resolver } = global);
    factory = model => new QueryBuilder({ resolver, schema, query: { model }, context: { network: { id: 'network' } } });
  });

  describe('transform', () => {
    test('findOne', async () => {
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

    test('findOne (undefined)', async () => {
      expect((await factory('Person').id(undefined).one().transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'read',
        op: 'findOne',
        key: 'getPerson',
        model: 'Person',
        input: undefined,
        where: {
          id: undefined,
          network: 'network',
        },
        args: {
          id: undefined,
        },
      });
    });

    test('findMany', async () => {
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
        args: {
          where: { name: 'RICH' },
          sort: { age: 'desc' },
        },
      });
    });

    test('updateMany', async () => {
      expect((await factory('Person').where({ name: 'rich' }).save({ name: 'RiChArD', emailAddress: 'rich@gmail.com' }).transform()).toObject()).toMatchObject({
        crud: 'update',
        op: 'updateMany',
        key: 'updatePerson',
        model: 'Person',
        args: {
          where: { name: 'rich' },
          input: { name: 'RiChArD', emailAddress: 'rich@gmail.com' },
        },
        input: {
          id: expect.thunk(ObjectId.isValid),
          name: 'richard',
          network: 'network',
          emailAddress: 'rich@gmail.com',
          updatedAt: expect.any(Date),
        },
      });
    });

    test('createOne', async () => {
      expect((await factory('Person').save({ name: 'RiChArD', emailAddress: 'rich@gmail.com' }).transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'create',
        op: 'createOne',
        key: 'createPerson',
        model: 'Person',
        args: {
          input: {
            name: 'RiChArD',
            emailAddress: 'rich@gmail.com',
          },
        },
        input: {
          id: expect.thunk(ObjectId.isValid),
          name: 'richard',
          network: 'network',
          emailAddress: 'rich@gmail.com',
          telephone: '###-###-####', // Create will set default input
          updatedAt: expect.any(Date),
          createdAt: expect.any(Date),
        },
      });
    });

    test('createMany', async () => {
      expect((await factory('Person').save({ name: 'RiChArD', emailAddress: 'rich@gmail.com' }, { name: 'another', emailAddress: 'a@notheR.com' }).transform()).toObject()).toMatchObject({
        id: undefined,
        crud: 'create',
        op: 'createMany',
        key: 'createPerson',
        model: 'Person',
        args: {
          input: [
            {
              name: 'RiChArD',
              emailAddress: 'rich@gmail.com',
            },
            {
              name: 'another',
              emailAddress: 'a@notheR.com',
            },
          ],
        },
        input: [
          {
            id: expect.thunk(ObjectId.isValid),
            name: 'richard',
            network: 'network',
            emailAddress: 'rich@gmail.com',
            telephone: '###-###-####', // Create will set default input
            updatedAt: expect.any(Date),
            createdAt: expect.any(Date),
          },
          {
            id: expect.thunk(ObjectId.isValid),
            name: 'another',
            network: 'network',
            emailAddress: 'a@notheR.com',
            telephone: '###-###-####', // Create will set default input
            updatedAt: expect.any(Date),
            createdAt: expect.any(Date),
          },
        ],
      });
    });

    test('deleteOne', async () => {
      expect((await factory('Person').id(1).delete().transform()).toObject()).toMatchObject({
        id: 1,
        crud: 'delete',
        op: 'deleteOne',
        key: 'deletePerson',
        model: 'Person',
        input: undefined,
        args: { id: 1 },
        where: {
          id: expect.thunk(ObjectId.isValid),
          network: 'network',
        },
      });
    });
  });
});
