module.exports = `
  scalar Date
  scalar Mixed

  type Author {
    id: ID! @field(key: "__id")
    name: String!
    bio: Mixed @field(key: "biography")
    telephone: String @field(default: "###-###-####")
    authored: [Book!]
  }

  type Library @model(key: "library") {
    id: ID! @field(key: "__id")
    name: String!
    books: [Book!]
  }

  type Book @model(source: "postgres") {
    id: ID
    name: String!
    author: Author!
  }
`;
