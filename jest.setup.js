const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Schema = require('./src/data/Schema');
const Resolver = require('./src/data/Resolver');
const config = require('./test/config');

let client, mongoServer;

const createIndexes = (mongoClient, indexes) => {
  return Promise.all(indexes.map(({ key, name, type, on }) => {
    const fields = on.reduce((prev, field) => Object.assign(prev, { [field]: 1 }), {});
    return mongoClient.collection(key).createIndex(fields, { name, [type]: true });
  }));
};

beforeAll(async () => {
  // Start mongo server
  mongoServer = await MongoMemoryReplSet.create({
    instanceOpts: [{ port: 27000 }],
    replSet: { storageEngine: 'wiredTiger' },
  });

  ({ client } = config.dataSources.default);
  const schema = new Schema(config).decorate().parse();
  const context = { network: { id: 'networkId' } };
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
