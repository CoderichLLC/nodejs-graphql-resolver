const Path = require('path');
const { autoMock } = require('@coderich/dev');

module.exports = () => {
  autoMock(Path.resolve(__dirname, '..'));
};
