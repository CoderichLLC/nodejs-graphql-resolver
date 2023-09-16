const Schema = require('../../src/data/Schema');
const config = require('./config');

describe('Schema', () => {
  test('parse', () => {
    expect(new Schema(config).parse()).toMatchObject({
      models: {
        Author: {
          name: 'Author',
          fields: {
            id: {
              key: '_id',
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
              key: 'biography',
              name: 'bio',
              type: 'Mixed',
            },
            telephone: {
              name: 'telephone',
              type: 'String',
              defaultValue: '###-###-####',
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
          fields: {
            id: {
              key: '_id',
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
