const { setup } = require('./jest.service');

beforeAll(async () => {
  await setup();
});

afterAll(() => {
  return Promise.all([
    global.mongoClient.disconnect(),
    global.mongoServer.stop(),
  ]);
});
