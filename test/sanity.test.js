describe('sanity', () => {
  test('promise', async () => {
    const val = await new Promise((resolve, reject) => {
      throw new Error('val better be 5');
    }).catch(() => 5);

    expect(val).toBe(5);
  });
});
