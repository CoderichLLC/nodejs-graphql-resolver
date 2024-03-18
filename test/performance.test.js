jest.setTimeout(60000);

describe('performance', () => {
  let resolver;

  beforeAll(async () => {
    ({ resolver } = global);
  });

  test('performance', async () => {
    // Create 1000 dummy people
    const input = Array.from(new Array(1000)).map((el, i) => ({
      age: 45,
      name: `person${i}`,
      emailAddress: `email${i}@gmail.com`,
      sections: Array.from(new Array(100)).map((ej, j) => ({
        name: `Section${j}`,
      })),
    }));

    console.time('createMany');
    const create = await resolver.match('Person').save(input);
    console.timeEnd('createMany');
    expect(create.length).toBe(1000);
    expect(create[0].age).toBe(45);
    expect(create[0].sections[0].name).toBe('section0');

    console.time('updateMany');
    const update = await resolver.match('Person').where({ age: 45 }).save({ age: 44 });
    console.timeEnd('updateMany');
    expect(update.length).toBe(1000);

    // console.time('updateRaw');
    // await resolver.raw('Person').updateMany({}, { $set: { age: 40 } });
    // console.timeEnd('updateRaw');

    console.time('findMany');
    const find = await resolver.match('Person').many();
    console.timeEnd('findMany');
    expect(find.length).toBe(1000);
  });
});
