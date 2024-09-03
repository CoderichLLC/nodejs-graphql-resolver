const ObjectId = require('bson-objectid');
const Pipeline = require('../../src/data/Pipeline');

describe('Pipeline', () => {
  let schema, resolver, context;
  let $cast, email, immutable, toLowerCase;

  beforeAll(() => {
    ({ schema, resolver, context } = global);
  });

  beforeEach(() => {
    $cast = jest.spyOn(Pipeline, '$cast');
    email = jest.spyOn(Pipeline, 'email');
    immutable = jest.spyOn(Pipeline, 'immutable');
    toLowerCase = jest.spyOn(Pipeline, 'toLowerCase');
  });

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
        id: expect.thunk(ObjectId.isValid),
        name: 'rich',
        emailAddress: 'email@gmail.com',
        sections: [
          expect.objectContaining({ id: expect.thunk(ObjectId.isValid), name: 'section1', updatedAt: expect.any(Date), createdAt: expect.any(Date) }),
          expect.objectContaining({ id: expect.thunk(ObjectId.isValid), name: 'section2', updatedAt: expect.any(Date), createdAt: expect.any(Date) }),
          expect.objectContaining({ id: expect.thunk(ObjectId.isValid), name: 'section3', updatedAt: expect.any(Date), createdAt: expect.any(Date) }),
        ],
      });

      // Spys
      expect(email).toHaveBeenCalledTimes(1);
      expect(immutable).toHaveBeenCalledTimes(0); // Only called on restruct
      expect($cast).toHaveBeenCalledTimes(33); // A lot (but we're invoking the wrapper)
      expect(toLowerCase).toHaveBeenCalledTimes(4); // names

      // Email payload
      expect(email).toHaveBeenCalledWith(expect.objectContaining({
        schema,
        context,
        value: 'email@gmail.com',
        startValue: 'email@gmail.com',
        query: expect.objectContaining({ model: 'Person' }),
        model: expect.objectContaining({ name: 'Person' }),
        field: expect.objectContaining({ name: 'emailAddress' }),
        path: ['emailAddress'],
      }));

      // Check path of embedded array
      expect(toLowerCase).toHaveBeenCalledWith(expect.objectContaining({
        value: 'section1',
        startValue: 'section1',
        query: expect.objectContaining({ model: 'Person' }),
        model: expect.objectContaining({ name: 'Section' }),
        field: expect.objectContaining({ name: 'name' }),
        path: ['sections', 0, 'name'],
      }));

      expect(toLowerCase).toHaveBeenCalledWith(expect.objectContaining({
        value: 'section2',
        startValue: 'section2',
        query: expect.objectContaining({ model: 'Person' }),
        model: expect.objectContaining({ name: 'Section' }),
        field: expect.objectContaining({ name: 'name' }),
        path: ['sections', 1, 'name'],
      }));

      expect(toLowerCase).toHaveBeenCalledWith(expect.objectContaining({
        value: 'section3',
        startValue: 'section3',
        query: expect.objectContaining({ model: 'Person' }),
        model: expect.objectContaining({ name: 'Section' }),
        field: expect.objectContaining({ name: 'name' }),
        path: ['sections', 2, 'name'],
      }));
    });
  });
});
