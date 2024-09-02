const { Schema, Resolver } = require('@coderich/autograph');
const schemaDef = require('./schema');
const TestSuite = require('./TestSuite');

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
