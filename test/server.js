// const get = require('lodash.get');
const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const JestService = require('../jest.service');
const { Resolver, Emitter } = require('../index');

(async () => {
  const { schema, context, mongoClient } = await JestService.setup();

  Emitter.on('setup', async (parsedSchema, next) => {
    await JestService.createIndexes(mongoClient, parsedSchema.indexes);
    next();
  });

  schema.merge({
    resolvers: {
      Query: {
        findPerson: (doc, args, ctx, info) => {
          return ctx.autograph.resolver.match('Person').args(args).resolve(info);
        },
      },
    },
  });

  await schema.setup();

  const server = new ApolloServer({
    schema: schema.makeExecutableSchema(),

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
