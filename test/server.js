// const get = require('lodash.get');
const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const JestService = require('../jest.service');
const { Resolver } = require('../index');

(async () => {
  const { schema, context, mongoClient } = await JestService.setup();
  await JestService.createIndexes(mongoClient, schema.parse().indexes);
  const xschema = makeExecutableSchema(schema.toObject());

  const server = new ApolloServer({
    schema: xschema,

    /**
     * Apollo Server creates a shallow copy of context which creates havoc for the world
     * https://github.com/apollographql/apollo-server/issues/3146
     */
    plugins: [
      {
        async requestDidStart({ request, contextValue }) {
          // console.log(request.http);
          // // Grab info from query and headers (query has precedence)
          // const headers = get(req, 'rawHeaders', []).reduce((prev, key, i, arr) => (i % 2 === 0 ? Object.assign(prev, { [key]: arr[i + 1] }) : prev), {});
          // const queryHeaders = { ...(headers || {}), ...get(req, 'query', {}) };
          // queryHeaders.workspace = get(queryHeaders, 'workspace', 'live').toLowerCase();
          // // queryHeaders.authToken = _.last(get(queryHeaders, 'authorization', get(queryHeaders, 'Authorization', '')).split('Bearer '));
          // queryHeaders.ipAddress = get(queryHeaders, 'sourceIp');
          // queryHeaders.requestId = get(req, 'info.id');
          // return API.finalizeContext(context, queryHeaders);
          new Resolver({ schema, context: Object.assign(contextValue, context) }); // eslint-disable-line
        },
      },
    ],
  });

  const { url } = await startStandaloneServer(server, {
    listen: { port: 4004 },
  });

  // eslint-disable-next-line no-console
  console.log(`🚀 Server ready at ${url}`);
})();
