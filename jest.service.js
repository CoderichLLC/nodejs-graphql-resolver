const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Schema = require('./src/schema/Schema');
const Config = require('./test/config');
const schemaDef = require('./test/schema');

exports.setup = async (mergeConfig) => {
  // Start mongo server
  const mongoServer = await MongoMemoryReplSet.create({ replSet: { storageEngine: 'wiredTiger' } });

  // Config
  const config = Config({ uri: mongoServer.getUri() });
  const { client: mongoClient } = config.dataSources.default;

  // Schema
  const schema = new Schema(config).framework().merge(schemaDef).merge(mergeConfig).decorate().api();
  const context = { network: { id: 'networkId' } };
  return { schema, mongoClient, mongoServer, context };
};

exports.createIndexes = (mongoClient, indexes) => {
  return Promise.all(indexes.map(({ key, name, type, on }) => {
    const fields = on.reduce((prev, field) => Object.assign(prev, { [field]: 1 }), {});
    return mongoClient.collection(key).createIndex(fields, { name, [type]: true });
  }));
};
