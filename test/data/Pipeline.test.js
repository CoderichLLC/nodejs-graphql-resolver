const Pipeline = require('../../src/data/Pipeline');

describe('Pipeline', () => {
  let resolver;
  let email, immutable, toTitleCase, toLowerCase;

  beforeAll(() => {
    ({ resolver } = global);
  });

  // beforeEach(() => {
  //   email = jest.spyOn(Pipeline, 'email');
  //   immutable = jest.spyOn(Pipeline, 'immutable');
  //   toTitleCase = jest.spyOn(Pipeline, 'toTitleCase');
  //   toLowerCase = jest.spyOn(Pipeline, 'toLowerCase');
  // });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('arguments', () => {
    test('create', async () => {
      const person = await resolver.match('Person').save({
        name: 'rich',
        emailAddress: 'email@gmail.com',
        sections: [
          { name: 'section1' },
          { name: 'section2' },
          { name: 'section3' },
        ],
      });

      // Sanity test the object was created as expected
      expect(person).toMatchObject({
        id: expect.anything(),
        name: 'Rich',
        emailAddress: 'email@gmail.com',
        sections: [
          expect.objectContaining({ id: expect.anything(), name: 'section1', updatedAt: expect.anything(), createdAt: expect.anything() }),
          expect.objectContaining({ id: expect.anything(), name: 'section2', updatedAt: expect.anything(), createdAt: expect.anything() }),
          expect.objectContaining({ id: expect.anything(), name: 'section3', updatedAt: expect.anything(), createdAt: expect.anything() }),
        ],
      });

      // Spys
      // expect(email).toHaveBeenCalledTimes(1);
      // expect(immutable).toHaveBeenCalledTimes(1);
      // expect(toLowerCase).toHaveBeenCalledTimes(1);
    });
  });
});
