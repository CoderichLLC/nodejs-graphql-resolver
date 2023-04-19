describe('mongodb', () => {
  test('insertOne', async () => {
    const doc = await global.driver.collection('test').insertOne();
    expect(doc).toBeDefined();
  });
});
