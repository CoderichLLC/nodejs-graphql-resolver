module.exports = {
  mongodbMemoryServerOptions: {
    binary: {
      version: '4.0.3',
      skipMD5: true,
    },
    autoStart: true,
    instance: {
      dbName: 'jest',
      port: 27000,
    },
  },
};
