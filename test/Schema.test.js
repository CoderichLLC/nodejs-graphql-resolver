const Path = require('path');
const Schema = require('../src/Schema');

describe('Schema', () => {
  test('parse', () => {
    expect(new Schema(Path.join(__dirname, 'schema.graphql')).parse()).toEqual({
      models: {
        Author: {
          pk: 'id',
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
            },
            name: {
              name: 'name',
              type: 'String',
              isRequired: true,
            },
            bio: {
              name: 'bio',
              type: 'Mixed',
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
          pk: 'id',
          name: 'Library',
          keyMap: {
            id: '_id',
          },
          fields: {
            id: {
              name: 'id',
              type: 'ID',
              isRequired: true,
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
        },
        Book: {
          pk: 'id',
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
        },
      },
    });
  });
});
