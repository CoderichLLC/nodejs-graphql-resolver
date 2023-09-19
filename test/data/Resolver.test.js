const Emitter = require('../../src/data/Emitter');

describe('Resolver', () => {
  let resolver, context;
  let doc, result;
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

      const matcher = expect.multiplex(
        val => expect(val).toMatchObject({
          context,
          resolver,
          args: expect.objectContaining({
            input: {
              name: 'Rich',
              emailAddress: 'email@gmail.com',
            },
          }),
          query: expect.objectContaining({
            isMutation: true,
            op: 'createOne',
            key: 'createPerson',
            crud: 'create',
            input: expect.objectContaining({
              id: expect.anything(),
              name: 'rich',
              emailAddress: 'email@gmail.com',
              telephone: '###-###-####',
              createdAt: expect.anything(),
              updatedAt: expect.anything(),
            }),
          }),
        }),
        (event) => {
          expect(event.args.input.id).toBeUndefined();
          expect(event.args.input.telephone).toBeUndefined();
          expect(event.args.input.updatedAt).toBeUndefined();
          expect(event.args.input.createdAt).toBeUndefined();
          expect(event.doc).toEqual(doc);
          expect(event.result).toEqual(result);
        },
      );

      expect(mocks.preQuery).toHaveBeenCalledTimes(0);
      expect(mocks.preQueryNext).toHaveBeenCalledTimes(0);
      expect(mocks.postQuery).toHaveBeenCalledTimes(0);
      expect(mocks.postQueryNext).toHaveBeenCalledTimes(0);
      expect(mocks.preMutation).toHaveBeenCalledTimes(1);
      expect(mocks.preMutation).toHaveBeenCalledWith(matcher);
      expect(mocks.preMutationNext).toHaveBeenCalledTimes(1);
      expect(mocks.preMutationNext).toHaveBeenCalledWith(matcher, expect.any(Function));
      expect(mocks.validate).toHaveBeenCalledTimes(1);
      expect(mocks.validateNext).toHaveBeenCalledTimes(1);
      expect(mocks.preResponse).toHaveBeenCalledTimes(1);
      expect(mocks.preResponseNext).toHaveBeenCalledTimes(1);
      expect(mocks.postResponse).toHaveBeenCalledTimes(1);
      expect(mocks.postResponseNext).toHaveBeenCalledTimes(1);
    });
  });
});
