const Schema = require('./Schema');

module.exports = class API extends Schema {
  toExecutableSchema() {
    return {
      typeDefs: this.#config.typeDefs,
      resolvers: this.#config.resolvers,
    };
  }

  static #api(schema) {
    return {
      typeDefs: `
        interface Node { id: ID! }

        enum SortOrderEnum { asc desc }
        enum SubscriptionCrudEnum { create update delete }
        enum SubscriptionWhenEnum { preEvent postEvent }

        type PageInfo {
          startCursor: String!
          endCursor: String!
          hasPreviousPage: Boolean!
          hasNextPage: Boolean!
        }

        type Query {
          node(id: ID!): Node
          entityModels.map(model => makeReadAPI(model.getName(), model))}
        }

        type Mutation {
          entityModels.map(model => makeCreateAPI(model.getName(), model))}
          entityModels.map(model => makeUpdateAPI(model.getName(), model))}
          entityModels.map(model => makeDeleteAPI(model.getName(), model))}
        }

        type Subscription {
          entityModels.map(model => makeSubscriptionAPI(model.getName(), model))}
        }
      `,
      resolvers: {

      },
    };
  }
};
