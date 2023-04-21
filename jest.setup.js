const MongoClient = require('./test/mongo/MongoClient');
const Schema = require('./src/data/Schema');
const Resolver = require('./src/data/Resolver');
const { typeDefs } = require('./test/schema');

let driver;

const createIndexes = (mongoClient, indexes) => {
  return Promise.all(indexes.map(({ model, name, type, on }) => {
    const collection = model.key || model.name;
    const $fields = on.reduce((prev, fieldName) => {
      const field = model.fields[fieldName];
      const key = field.key || field.name;
      return Object.assign(prev, { [key]: 1 });
    }, {});
    return mongoClient.collection(collection).createIndex($fields, { name, [type]: true });
  }));
};

beforeAll(async () => {
  driver = new MongoClient({ uri: 'mongodb://127.0.0.1:27000/jest' });
  const schema = new Schema(typeDefs).parse();
  const context = { network: { id: 'networkId' } };
  await createIndexes(driver, schema.indexes);
  global.resolver = new Resolver({ schema, context, driver });
});

afterAll(() => {
  return driver.disconnect();
});
