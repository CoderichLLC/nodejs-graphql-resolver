describe('Query', () => {
  let resolver;

  beforeAll(() => {
    ({ resolver } = global);
  });

  test('toDriver', async () => {
    const query = resolver.match('Person').where({ 'section.person.name': 'rich' }).toQuery();
    const toObject = await query.toObject(); // Pipeline
    const toDriver = query.toDriver(toObject);

    expect(toDriver).toMatchObject({
      where: {
        network: 'networkId',
      },
      joins: [
        {
          to: 'Person',
          on: '_id',
          from: 'section.person',
          where: {
            name: 'rich',
          },
        },
      ],
    });
  });
});
