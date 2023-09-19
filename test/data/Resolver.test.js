const Emitter = require('../../src/data/Emitter');

describe('Resolver', () => {
  let resolver, context;
  const mocks = {};

  beforeAll(() => {
    Emitter.cloneData = true;
    ({ context, resolver } = global);
  });

  afterAll(() => {
    delete Emitter.cloneData;
  });

  beforeEach(() => {
    ['preQuery', 'postQuery', 'preMutation', 'postMutation', 'validate', 'preResponse', 'postResponse'].forEach((eventName) => {
      mocks[eventName] = jest.fn((event) => {});
      mocks[`${eventName}Next`] = jest.fn((event, next) => next());
      Emitter.once(eventName, mocks[eventName]);
      Emitter.once(eventName, mocks[`${eventName}Next`]);
    });
  });

  describe('System Events', () => {
    test('create', async () => {
      await resolver.match('Person').save({ name: 'Rich', emailAddress: 'email@gmail.com' });
      const event = expect.objectContaining({
        context,
        resolver,
        args: expect.multiplex(
          val => expect(val).toMatchObject({
            input: expect.objectContaining({
              name: 'Rich',
              emailAddress: 'email@gmail.com',
            }),
          }),
          ({ input }) => {
            expect(input.id).toBeUndefined();
            expect(input.telephone).toBeUndefined();
            expect(input.updatedAt).toBeUndefined();
            expect(input.createdAt).toBeUndefined();
          },
        ),
        query: expect.multiplex(
          val => expect(val).toMatchObject({
            isMutation: true,
            op: 'createOne',
            key: 'createPerson',
            crud: 'create',
            input: expect.objectContaining({
              id: expect.anything(),
              name: 'rich',
              emailAddress: 'email@gmail.com',
              telephone: '###-###-####',
            }),
          }),
          ({ doc, result }) => {
            expect(doc).toBeUndefined();
            expect(result).toBeUndefined();
          },
        ),
      });
      expect(mocks.preQuery).toHaveBeenCalledTimes(0);
      expect(mocks.preQueryNext).toHaveBeenCalledTimes(0);
      expect(mocks.postQuery).toHaveBeenCalledTimes(0);
      expect(mocks.postQueryNext).toHaveBeenCalledTimes(0);
      expect(mocks.preMutation).toHaveBeenCalledTimes(1);
      expect(mocks.preMutation).toHaveBeenCalledWith(event);
      expect(mocks.preMutationNext).toHaveBeenCalledTimes(1);
      expect(mocks.preMutationNext).toHaveBeenCalledWith(event, expect.any(Function));
      expect(mocks.validate).toHaveBeenCalledTimes(1);
      expect(mocks.validateNext).toHaveBeenCalledTimes(1);
      expect(mocks.preResponse).toHaveBeenCalledTimes(1);
      expect(mocks.preResponseNext).toHaveBeenCalledTimes(1);
      expect(mocks.postResponse).toHaveBeenCalledTimes(1);
      expect(mocks.postResponseNext).toHaveBeenCalledTimes(1);
    });
  });
});
