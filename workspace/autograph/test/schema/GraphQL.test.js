const { graphql } = require('graphql');
const { makeExecutableSchema } = require('@graphql-tools/schema');

describe('GraphQL', () => {
  let xschema, $schema, context, resolver;
  let person, book;

  beforeAll(async () => {
    ({ $schema, context, resolver } = global);
    xschema = makeExecutableSchema($schema.toObject());
  });

  test('create', async () => {
    const [{ errors, data }] = await Promise.all(['rich', 'anne'].map((name) => {
      return graphql({
        schema: xschema,
        contextValue: context,
        source: `
          mutation ($input: PersonInputCreate!) {
            createPerson(input: $input) {
              id
            }
          }
        `,
        variableValues: {
          input: { name, emailAddress: 'email@gmail.com' },
        },
      });
    }));
    expect(errors).not.toBeDefined();
    expect(data).toBeDefined();
    person = data.createPerson;

    // Let's quickly create some FK data
    book = await resolver.match('Book').save({ name: 'book', price: 10, author: person.id });
  });

  test('getPerson (authored connection)', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        query {
          getPerson(id: "${person.id}") {
            id
            authored {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
      `,
    })).toEqual({
      errors: undefined,
      data: {
        getPerson: {
          id: `${person.id}`,
          authored: {
            edges: [{
              node: {
                id: expect.anything(),
                name: 'Book', // toTitleCase
              },
            }],
          },
        },
      },
    });
  });

  test('getBook (author)', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        query {
          getBook(id: "${book.id}") {
            id
            author { name }
          }
        }
      `,
    })).toEqual({
      errors: undefined,
      data: {
        getBook: {
          id: `${book.id}`,
          author: { name: 'rich' },
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

  test('update', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        mutation ($id: ID!, $input: PersonInputUpdate) {
          updatePerson(id: $id, input: $input) {
            id
            name
          }
        }
      `,
      variableValues: {
        id: person.id,
        input: { name: 'richie' },
      },
    })).toEqual({
      errors: undefined,
      data: {
        updatePerson: {
          id: `${person.id}`,
          name: 'richie',
        },
      },
    });
  });

  test('delete', async () => {
    expect(await graphql({
      schema: xschema,
      contextValue: context,
      source: `
        mutation ($id: ID!) {
          deletePerson(id: $id) {
            id
            name
          }
        }
      `,
      variableValues: { id: person.id },
    })).toEqual({
      errors: undefined,
      data: {
        deletePerson: {
          id: `${person.id}`,
          name: 'richie',
        },
      },
    });
  });
});
