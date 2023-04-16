const MongoClient = require('./test/mongo/MongoClient');
const Schema = require('./src/data/Schema');
const Resolver = require('./src/data/Resolver');
const { typeDefs } = require('./test/schema');

let driver;

beforeAll(() => {
  driver = new MongoClient({ uri: 'mongodb://127.0.0.1:27000/jest' });
  const schema = new Schema(typeDefs).parse();
  const context = { network: { id: 'networkId' } };
  global.resolver = new Resolver({ schema, context, driver });
});

afterAll(() => {
  return driver.disconnect();
});
