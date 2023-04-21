const Validator = require('validator');
const MongoClient = require('./test/mongo/MongoClient');
const Schema = require('./src/data/Schema');
const Resolver = require('./src/data/Resolver');
const Pipeline = require('./src/data/Pipeline');
const { typeDefs } = require('./test/schema');

let driver;

Pipeline.define('email', ({ value }) => {
  if (!Validator.isEmail(value)) throw new Error('Invalid email');
});

const createIndexes = (mongoClient, indexes) => {
  return Promise.all(indexes.map(({ key, name, type, on }) => {
    const fields = on.reduce((prev, field) => Object.assign(prev, { [field]: 1 }), {});
    return mongoClient.collection(key).createIndex(fields, { name, [type]: true });
  }));
};

beforeAll(async () => {
  driver = new MongoClient({ uri: 'mongodb://127.0.0.1:27000/jest' });
  const schema = new Schema(typeDefs).parse();
  const context = { network: { id: 'networkId' } };
  await createIndexes(driver, schema.indexes);
  global.resolver = new Resolver({ schema, context, driver });
  global.mongoClient = driver;
});

afterAll(() => {
  return driver.disconnect();
});
