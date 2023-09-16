describe('Query', () => {
  let resolver;

  beforeAll(() => {
    ({ resolver } = global);
  });

  test.todo('something');
  // test('toDriver', async () => {
  //   const query = resolver.match('Person').where({ 'section.person.name': 'rich' });
  //   const transformed = await query.transform(); // Pipeline
  //   const toDriver = transformed.toDriver();

  //   expect(toDriver).toMatchObject({
  //     where: {
  //       network: 'networkId',
  //     },
  //     joins: [
  //       {
  //         to: 'Person',
  //         on: '_id',
  //         from: 'section.person',
  //         where: {
  //           name: 'rich',
  //         },
  //       },
  //     ],
  //   });
  // });
});
