const Schema = require('../../src/schema/Schema');
const { mergeDeep } = require('../../src/service/AppService');
const config = require('./config');
const typeDefs = require('./schema');

const parsedModels = {
  Author: {
    name: 'Author',
    fields: {
      id: {
        key: '__id',
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
        key: '__id',
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
      id: {
        key: 'id',
        name: 'id',
        type: 'ID',
      },
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
};

describe('Schema', () => {
  test('parse', () => {
    expect(new Schema(config).merge(typeDefs).toObject()).toMatchObject({
      models: parsedModels,
    });
  });

  test('decorate', () => {
    const models = mergeDeep(parsedModels, {
      Book: {
        fields: {
          id: {
            key: '_id',
            isRequired: true,
          },
        },
      },
    });

    expect(new Schema(config).merge(typeDefs).decorate().toObject()).toMatchObject({ models });
  });

  test('merge', () => {
    const schema = new Schema(config).merge(typeDefs).merge({
      typeDefs: `
        type Person { id: ID name: String! }
        type Author {
          telephone: Int! @field(key: "tele")
          extended: String!
          bio: Mixed! @field(key: "bio2")
        }
      `,
    }).toObject();

    // Unchanged
    expect(schema.models.Library).toMatchObject(parsedModels.Library);
    expect(schema.models.Book).toMatchObject(parsedModels.Book);

    // New type
    expect(schema.models.Person).toMatchObject({
      name: 'Person',
      fields: {
        id: { name: 'id', type: 'ID' },
        name: { name: 'name', type: 'String', isRequired: true },
      },
    });

    // Altered type
    const author = mergeDeep(parsedModels.Author, {
      fields: {
        telephone: { key: 'tele', name: 'telephone', type: 'Int', isRequired: true },
        extended: { name: 'extended', type: 'String', isRequired: true },
        bio: { key: 'bio2', name: 'bio', type: 'Mixed', isRequired: true },
      },
    });
    expect(schema.models.Author).toMatchObject(author);
  });
});
