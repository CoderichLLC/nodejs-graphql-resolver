const { ObjectId } = require('mongodb');
const Validator = require('validator');
const MongoClient = require('./MongoClient');
const Pipeline = require('../src/data/Pipeline');

Pipeline.define('bookName', Pipeline.Deny('The Bible'));
Pipeline.define('bookPrice', Pipeline.Range(0, 100));
Pipeline.define('artComment', Pipeline.Allow('yay', 'great', 'boo'));
Pipeline.define('colors', Pipeline.Allow('blue', 'red', 'green', 'purple'));
Pipeline.define('buildingType', Pipeline.Allow('home', 'office', 'business'));
Pipeline.define('networkID', ({ context }) => context.network.id, { ignoreNull: false });
Pipeline.define('email', ({ value }) => {
  if (!Validator.isEmail(value)) throw new Error('Invalid email');
});

module.exports = {
  dataLoaders: {
    default: {
      cache: true,
    },
  },
  dataSources: {
    default: {
      idValue: (value) => {
        if (value instanceof ObjectId) return value;

        try {
          const id = new ObjectId(value);
          return id;
        } catch (e) {
          return value;
        }
      },
      supports: [],
      client: new MongoClient({
        uri: 'mongodb://127.0.0.1:27000/?replicaSet=testset',
        options: { useNewUrlParser: true, useUnifiedTopology: true, ignoreUndefined: false, minPoolSize: 3 },
        query: { collation: { locale: 'en', strength: 2 }, readPreference: 'primary' },
        session: { retryWrites: true, readPreference: { mode: 'primary' }, readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
        transaction: { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
      }),
    },
  },
  decorators: {
    default: `
      id: ID! @field(key: "_id", serialize: "$pk")
      createdAt: String @field(serialize: createdAt, gqlScope: r)
      updatedAt: String @field(serialize: timestamp, gqlScope: r)
    `,
  },
  typeDefs: `
    input PersonInputMeta {
      notify: Boolean
    }

    type Person
      @model(meta: "PersonInputMeta")
      @index(name: "uix_person_name", type: unique, on: [name])
    {
      age: Int @field(key: "my_age")
      name: String! @field(deserialize: toTitleCase, serialize: toLowerCase)
      authored: [Book] @link(by: author) @field(connection: true)
      emailAddress: String! @field(key: "email_address", validate: email)
      friends: [Person] @field(transform: dedupe, validate: selfless, onDelete: cascade, connection: true)
      status: String @field(key: "state")
      state: String @field(key: "address_state")
      telephone: String @field(default: "###-###-####")
      network: String @field(instruct: networkID)
      manipulate: String
      section: Section
      sections: [Section!]
      multiLang: AutoGraphMixed
    }

    type Book
      @model
      @index(name: "uix_book", type: unique, on: [name, author])
    {
      name: String! @field(transform: toTitleCase, validate: bookName)
      price: Float! @field(validate: bookPrice)
      author: Person! @field(validate: immutable, onDelete: cascade)
      bestSeller: Boolean
      bids: [Float]
      chapters: [Chapter] @link(by: book)
    }

    type Chapter
      @model
      @index(name: "uix_chapter", type: unique, on: [name, book])
    {
      name: String! @field(key: "chapter_name" transform: toTitleCase)
      book: Book! @field(onDelete: restrict)
      pages: [Page] @link(by: chapter)
    }

    type Page
      @model
      @index(name: "uix_page", type: unique, on: [number, chapter])
    {
      number: Int!
      verbage: String
      chapter: Chapter!
    }

    type BookStore
      @model
      @index(name: "uix_bookstore", type: unique, on: [name])
    {
      name: String! @field(transform: toTitleCase)
      location: String
      books: [Book] @field(onDelete: cascade)
      building: Building!
    }

    type Library
      @model
      @index(name: "uix_library", type: unique, on: [name])
      @index(name: "uix_library_bulding", type: unique, on: [building])
    {
      name: String! @field(transform: toTitleCase)
      location: String,
      books: [Book] @field(onDelete: cascade)
      building: Building!
    }

    type Apartment
      @model
      @index(name: "uix_apartment", type: unique, on: [name])
      @index(name: "uix_apartment_bulding", type: unique, on: [building])
    {
      name: String! @field(transform: toTitleCase)
      location: String
      building: Building!
    }

    type Building
    {
      year: Int @field(key: "year_built")
      type: String! @field(validate: buildingType)
      tenants: [Person] @field(onDelete: cascade)
      landlord: Person @field(onDelete: nullify)
      description: String @field(default: "A building from the bloom")
    }

    type Color
      @model
    {
      type: String! @field(validate: colors)
      isDefault: Boolean
    }

    type Art
      @model
    {
      name: String! @field(transform: toTitleCase)
      bids: [Float]
      comments: [String] @field(validate: artComment)
      sections: [Section]
    }

    type Section @model(embed: true) {
      name: String! @field(transform: toLowerCase)
      frozen: String! @field(default: "frozen", validate: immutable)
      description: String
      person: Person
    }

    type PlainJane @model {
      id: ID!
      name: String
    }
  `,
};
