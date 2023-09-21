const get = require('lodash.get');
const Util = require('@coderich/util');
const Emitter = require('../../src/data/Emitter');

describe('Resolver', () => {
  let resolver, context, query, event, $event, person;

  // Dynamic Jest Matching
  const mocks = {};
  const hooks = ['preQuery', 'postQuery', 'preMutation', 'postMutation', 'validate', 'preResponse', 'postResponse'];
  const matcher = expect.multiplex(
    val => expect(val).toMatchObject({ context, resolver, query: event }),
    (e) => {
      Object.entries(Util.flatten($event)).forEach(([key, value]) => {
        expect(get(e, key)).toEqual(value);
      });
    },
  );
  const asserter = (eventNames, calledTimes) => {
    event = { ...query };
    if (event.args) event.args = expect.objectContaining(event.args);
    if (event.input) event.input = expect.objectContaining(event.input);
    event = expect.objectContaining(event);

    eventNames.forEach((hook) => {
      const [basicFunc, nextFunc] = [mocks[hook], mocks[`${hook}Next`]];
      expect(basicFunc).toHaveBeenCalledTimes(calledTimes);
      if (calledTimes) expect(basicFunc).toHaveBeenCalledWith(matcher);
      if (nextFunc) expect(nextFunc).toHaveBeenCalledTimes(calledTimes);
      if (nextFunc && calledTimes) expect(nextFunc).toHaveBeenCalledWith(matcher, expect.any(Function));
    });
  };

  beforeAll(() => {
    ({ context, resolver } = global);
    Emitter.cloneData = true;
  });

  afterAll(() => {
    delete Emitter.cloneData;
  });

  beforeEach(() => {
    query = event = {};

    $event = {
      'query.doc': undefined,
      'query.result': undefined,
      'query.args.input.id': undefined,
      'query.args.input.updatedAt': undefined,
      'query.args.input.createdAt': undefined,
    };

    // Create mock functions
    hooks.forEach((eventName, i) => {
      mocks[eventName] = jest.fn((e) => {});
      mocks[`${eventName}Next`] = jest.fn((e, next) => next());
      Emitter.once(eventName, mocks[eventName]);
      Emitter.once(eventName, mocks[`${eventName}Next`]);
    });
  });

  describe('System Events', () => {
    test('create', async () => {
      query = { model: 'Person', op: 'createOne', key: 'createPerson', crud: 'create', isMutation: true };
      query.args = { input: { name: 'Rich', emailAddress: 'email@gmail.com' } };
      query.input = { id: expect.anything(), name: 'rich', emailAddress: 'email@gmail.com', telephone: '###-###-####', createdAt: expect.anything(), updatedAt: expect.anything() };
      $event['args.input.telephone'] = undefined;

      // Create person
      person = await resolver.match('Person').save(query.args.input);

      // No Query hooks should have been called
      asserter(['preQuery', 'postQuery'], 0);

      // Pre Mutation + validate
      asserter(['preMutation', 'validate'], 1);

      // Post Mutation + Responses
      $event['query.result'] = person; // There is only a result (no doc on create)
      asserter(['postMutation', 'preResponse', 'postResponse'], 1);
    });

    test('update', async () => {
      // Update person
      await resolver.match('Person').id(person.id).save({ age: 45 });

      // Pre Query
      query = { model: 'Person', op: 'findOne', key: 'getPerson', crud: 'read' };
      asserter(['preQuery'], 1);

      // Post Query
      $event['query.result'] = person;
      asserter(['postQuery'], 1);

      // // Pre Mutation + validate
      // console.log(person);
      // $event['query.doc'] = person;
      // $event['query.result'] = undefined;
      // query = { model: 'Person', op: 'updateOne', key: 'updatePerson', crud: 'update', isMutation: true };
      // asserter(['preMutation'], 1);

      // // // Post Mutation + Responses
      // // $query.result = person; // There is only a result (no doc on create)
      // // asserter(['postMutation', 'preResponse', 'postResponse'], 1);
    });
  });
});
