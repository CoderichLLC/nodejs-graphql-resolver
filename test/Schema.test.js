const Schema = require('../src/Schema');

describe('Schema', () => {
  test('parse', () => {
    expect(new Schema(`
      scalar Mixed

      type Person @model(key: "person") {
        id: ID!
        name: String!
        age: Int
        bio: Mixed @field(key: "biography")
        books: [Book!]
      }

      type Book @model(source: "postgres") {
        name: String!
      }
    `).parse()).toEqual({
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
          directives: {
            model: {
              source: 'postgres',
            },
          },
        },
      },
    });
  });
});
