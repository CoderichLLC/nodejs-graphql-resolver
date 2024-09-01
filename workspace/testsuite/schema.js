const Validator = require('validator');
const { Pipeline } = require('@coderich/autograph');
const typeDefs = require('./typeDefs');
const resolvers = require('./resolvers');

Pipeline.define('bookName', Pipeline.Deny('The Bible'));
Pipeline.define('bookPrice', Pipeline.Range(0, 100));
Pipeline.define('artComment', Pipeline.Allow('yay', 'great', 'boo'));
Pipeline.define('colors', Pipeline.Allow('blue', 'red', 'green', 'purple'));
Pipeline.define('networkID', ({ context }) => context.network.id, { ignoreNull: false });
Pipeline.define('email', ({ value }) => {
  if (!Validator.isEmail(value)) throw new Error('Invalid email');
});

module.exports = { typeDefs, resolvers };
