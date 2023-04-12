const Path = require('path');
const Schema = require('../src/Schema');

describe('Schema', () => {
  test('parse', () => {
    expect(new Schema(Path.join(__dirname, 'schema.graphql')).parse()).toEqual({
      models: {
        Author: {
          name: 'Author',
          keyMap: {
            id: '_id',
            bio: 'biography',
          },
          fields: {
            id: {
              name: 'id',
              type: 'ID',
              isRequired: true,
              directives: {
                field: {
                  key: '_id',
                },
              },
            },
            name: {
              name: 'name',
              type: 'String',
              isRequired: true,
            },
            bio: {
              name: 'bio',
              type: 'Mixed',
              directives: {
                field: {
                  key: 'biography',
                },
              },
            },
            authored: {
              name: 'authored',
              type: 'Book',
              isArray: true,
              isArrayRequired: true,
            },
          },
        },
        Library: {
          name: 'Library',
          keyMap: {
            id: '_id',
          },
          fields: {
            id: {
              name: 'id',
              type: 'ID',
              isRequired: true,
              directives: {
                field: {
                  key: '_id',
                },
              },
            },
            name: {
              name: 'name',
              type: 'String',
              isRequired: true,
            },
            books: {
              name: 'books',
              type: 'Book',
              isArray: true,
              isArrayRequired: true,
            },
          },
          directives: {
            model: {
              key: 'library',
            },
          },
        },
        Book: {
          name: 'Book',
          fields: {
            name: {
              name: 'name',
              type: 'String',
              isRequired: true,
            },
            author: {
              name: 'author',
              type: 'Author',
              isRequired: true,
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
