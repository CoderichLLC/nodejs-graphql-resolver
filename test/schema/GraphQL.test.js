const { graphql } = require('graphql');
const { makeExecutableSchema } = require('@graphql-tools/schema');

describe('GraphQL', () => {
  let xschema, $schema, resolver, context;
  let person;

  beforeAll(async () => {
    ({ $schema, resolver, context } = global);
    xschema = makeExecutableSchema($schema.toObject());
    [person] = await Promise.all([
      resolver.match('Person').save({ name: 'rich', emailAddress: 'email@gmail.com' }),
      resolver.match('Person').save({ name: 'anne', emailAddress: 'email@gmail.com' }),
    ]);
  });

  test('get', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        query {
          getPerson(id: "${person.id}") {
            id
          }
        }
      `,
    })).toEqual({
      errors: undefined,
      data: {
        getPerson: {
          id: `${person.id}`,
        },
      },
    });
  });

  test('find', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        query {
          findPerson {
            count
            edges {
              cursor
              node { id name }
            }
            pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
          }
        }
      `,
    })).toEqual({
      errors: undefined,
      data: {
        findPerson: {
          count: 2,
          pageInfo: null,
          edges: expect.arrayContaining([{
            cursor: null,
            node: {
              id: `${person.id}`,
              name: 'rich',
            },
          }, {
            cursor: null,
            node: {
              id: expect.anything(),
              name: 'anne',
            },
          }]),
        },
      },
    });
  });

  test('find (where)', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        query {
          findPerson(where: {
            name: "anne"
          }) {
            count
            edges {
              cursor
              node { id name }
            }
            pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
          }
        }
      `,
    })).toEqual({
      errors: undefined,
      data: {
        findPerson: {
          count: 1,
          pageInfo: null,
          edges: expect.arrayContaining([{
            cursor: null,
            node: {
              id: expect.anything(),
              name: 'anne',
            },
          }]),
        },
      },
    });
  });

  test('find (sort, cursorPaginating)', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        query {
          findPerson(
            first: 1
            sortBy: { name: asc }
          ) {
            count
            edges {
              cursor
              node { id name }
            }
            pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
          }
        }
      `,
    })).toEqual({
      errors: undefined,
      data: {
        findPerson: {
          count: 2,
          pageInfo: {
            startCursor: expect.anything(),
            endCursor: expect.anything(),
            hasPreviousPage: false,
            hasNextPage: true,
          },
          edges: [{
            cursor: expect.anything(),
            node: {
              id: expect.anything(),
              name: 'anne',
            },
          }],
        },
      },
    });
  });
});
