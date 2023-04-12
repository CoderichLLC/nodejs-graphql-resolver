const Resolver = require('../src/Resolver');

describe('Resolver', () => {
  test('parse', () => {
    expect(Resolver.parse(`
      scalar Mixed

      type Person @model(key: "person") {
        id: ID!
        name: String!
        age: Int
        bio: Mixed @field(key: "biography")
        books: [Book!]
      }

      type Book {
        name: String!
      }
    `)).toEqual({
      models: {
        Person: {
          fields: {
            id: {
              type: 'ID',
              required: true,
            },
            name: {
              type: 'String',
              required: true,
            },
            age: {
              type: 'Int',
            },
            bio: {
              type: 'Mixed',
              directives: {
                field: {
                  key: 'biography',
                },
              },
            },
            books: {
              type: 'Book',
              isArray: true,
              arrayRequired: true,
            },
          },
          directives: {
            model: {
              key: 'person',
            },
          },
        },
        Book: {
          fields: {
            name: {
              type: 'String',
              required: true,
            },
          },
        },
      },
    });
  });
});
