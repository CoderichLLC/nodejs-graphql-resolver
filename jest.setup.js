const Schema = require('./src/data/Schema');
const Resolver = require('./src/data/Resolver');
const config = require('./test/config');

let driver;

const createIndexes = (mongoClient, indexes) => {
  return Promise.all(indexes.map(({ key, name, type, on }) => {
    const fields = on.reduce((prev, field) => Object.assign(prev, { [field]: 1 }), {});
    return mongoClient.collection(key).createIndex(fields, { name, [type]: true });
  }));
};

beforeAll(async () => {
  ({ driver } = config.dataSources.default);
  const schema = new Schema(config).parse();
  const context = { network: { id: 'networkId' } };
  await createIndexes(driver, schema.indexes);
  global.resolver = new Resolver({ schema, context });
  global.mongoClient = driver;
});

afterAll(() => {
  return driver.disconnect();
});
