describe('performance', () => {
  let resolver;

  beforeAll(async () => {
    ({ resolver } = global);

    // Create 1000 dummy people
    const input = Array.from(new Array(1000)).map((el, i) => ({
      age: 45,
      name: `person${i}`,
      emailAddress: `email${i}@gmail.com`,
      sections: Array.from(new Array(100)).map((ej, j) => ({
        name: `section${j}`,
      })),
    }));
    console.time('createMany');
    const people = await resolver.match('Person').save(input);
    console.timeEnd('createMany');
    expect(people.length).toBe(1000);
  });

  test('findMany', async () => {
    console.time('findMany');
    const people = await resolver.match('Person').many();
    console.timeEnd('findMany');
    expect(people.length).toBe(1000);
  });
});
