const Schema = require('../../src/schema/Schema');
const { mergeDeep } = require('../../src/service/AppService');

const config = {
  decorators: {
    default: `
      type decorator {
        id: ID! @field(key: "_id")
        createdAt: Date @field(serialize: createdAt, crud: r)
        updatedAt: Date @field(serialize: [timestamp, toDate], crud: r)
      }
    `,
  },
};

const typeDefs = `
  scalar Date
  scalar Mixed

  type Author {
    id: ID! @field(key: "__id")
    name: String!
    bio: Mixed @field(key: "biography")
    telephone: String @field(default: "###-###-####")
    authored: [Book!]
  }

  type Library @model(key: "library") {
    id: ID! @field(key: "__id")
    name: String!
    books: [Book!]
  }

  type Book @model(source: "postgres") {
    id: ID
    name: String!
    author: Author!
  }
`;

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
    expect(new Schema(config).merge(typeDefs).parse()).toMatchObject({
      models: parsedModels,
    });
  });

  test('parse (with api)', () => {
    expect(new Schema(config).merge(typeDefs).api().parse()).toMatchObject({
      models: parsedModels,
    });
  });

  test('decorate', () => {
    const models = mergeDeep(parsedModels, {
      Book: {
        fields: {
          id: {
            key: '_id',
            // isRequired: true, // This should NOT be merged because it's a conflict and original wins
          },
        },
      },
    });

    expect(new Schema(config).merge(typeDefs).decorate().parse()).toMatchObject({ models });
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
    }).parse();

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
