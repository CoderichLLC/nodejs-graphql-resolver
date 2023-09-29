const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Schema = require('./src/schema/Schema');
const Resolver = require('./src/data/Resolver');
const Config = require('./test/config');
const schemaDef = require('./test/schema');

let client = { disconnect: () => Promise.resolve() };
let mongoServer = { stop: () => Promise.resolve() };

const createIndexes = (mongoClient, indexes) => {
  return Promise.all(indexes.map(({ key, name, type, on }) => {
    const fields = on.reduce((prev, field) => Object.assign(prev, { [field]: 1 }), {});
    return mongoClient.collection(key).createIndex(fields, { name, [type]: true });
  }));
};

// Extend jest!
expect.extend({
  thunk: (val, fn) => {
    const pass = Boolean(fn(val));
    return { pass };
  },
  multiplex: (val, ...expectations) => {
    try {
      expectations.flat().forEach((expectation) => {
        expectation(val);
      });
      return { pass: true };
    } catch ({ message }) {
      return { message, pass: false };
    }
  },
});

beforeAll(async () => {
  // Start mongo server
  mongoServer = await MongoMemoryReplSet.create({ replSet: { storageEngine: 'wiredTiger' } });

  // Config
  const config = Config({ uri: mongoServer.getUri() });
  ({ client } = config.dataSources.default);
  const schema = new Schema(config)
    .merge(schemaDef)
    .decorate()
    .merge({
      typeDefs: `
        type Library {
          id: ID
        }
      `,
    })
    .toObject();
  // const api = new API(schema).decorate().toObject();
  // const xschema = makeExecutableSchema(schema.merge(api).toObject());
  const context = global.context = { network: { id: 'networkId' } };
  await createIndexes(client, schema.indexes);
  global.schema = schema;
  global.resolver = new Resolver({ schema, context });
  global.mongoClient = client;
});

afterAll(() => {
  return Promise.all([
    client.disconnect(),
    mongoServer.stop(),
  ]);
});
