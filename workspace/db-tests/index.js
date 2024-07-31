const Validator = require('validator');
const { Schema, Resolver, Pipeline } = require('@coderich/autograph');
const schemaDef = require('./schema');
const TestSuite = require('./TestSuite');

Pipeline.define('bookName', Pipeline.Deny('The Bible'));
Pipeline.define('bookPrice', Pipeline.Range(0, 100));
Pipeline.define('artComment', Pipeline.Allow('yay', 'great', 'boo'));
Pipeline.define('colors', Pipeline.Allow('blue', 'red', 'green', 'purple'));
Pipeline.define('networkID', ({ context }) => context.network.id, { ignoreNull: false });
Pipeline.define('email', ({ value }) => {
  if (!Validator.isEmail(value)) throw new Error('Invalid email');
});

exports.testSuite = TestSuite;

exports.setup = ({ generator, dataSource }) => {
  const config = {
    namespace: 'autograph',
    generators: { default: generator },
    dataLoaders: { default: { cache: true } },
    dataSources: { default: dataSource },
    decorators: {
      default: `
        type default {
          id: ID! @field(key: "_id")
          createdAt: Date @field(serialize: createdAt, crud: r)
          updatedAt: Date @field(serialize: [timestamp, toDate], crud: r)
        }
      `,
    },
  };

  const schema = new Schema(config).framework().merge(schemaDef).decorate().api();
  const context = { network: { id: 'networkId' } };
  const resolver = new Resolver({ schema, context });

  return { context, schema, resolver };
};
