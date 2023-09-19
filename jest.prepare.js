const Path = require('path');
const { autoMock } = require('@coderich/dev');

module.exports = () => {
  autoMock(Path.join(__dirname));
};
