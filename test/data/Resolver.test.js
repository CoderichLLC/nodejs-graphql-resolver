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
        try {
          expect(get(e, key)).toEqual(value);
        } catch ({ message }) {
          console.log(key, message);
          throw new Error(message);
        }
      });
    },
  );
  const asserter = (eventNames, calledTimes, doMatch = true) => {
    event = { ...query };
    if (event.input) event.input = expect.objectContaining(event.input);
    event = expect.objectContaining(event);

    eventNames.forEach((hook) => {
      const [basicFunc, nextFunc] = [mocks[hook], mocks[`${hook}Next`]];
      expect(basicFunc).toHaveBeenCalledTimes(calledTimes);
      if (calledTimes && doMatch) expect(basicFunc).toHaveBeenCalledWith(matcher);
      if (nextFunc) expect(nextFunc).toHaveBeenCalledTimes(calledTimes);
      if (nextFunc && calledTimes && doMatch) expect(nextFunc).toHaveBeenCalledWith(matcher, expect.any(Function));
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
      Emitter.on(eventName, mocks[eventName]);
      Emitter.on(eventName, mocks[`${eventName}Next`]);
    });
  });

  describe('System Events', () => {
    test('create', async () => {
      query = { model: 'Person', op: 'createOne', key: 'createPerson', crud: 'create', isMutation: true };
      query.args = { input: { name: 'Rich', emailAddress: 'email@gmail.com' } };
      query.input = { id: expect.anything(), name: 'rich', emailAddress: 'email@gmail.com', telephone: '###-###-####', createdAt: expect.anything(), updatedAt: expect.anything() };
      $event['args.input.telephone'] = undefined; // Test that defaultValue is not applied here

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
      const updatedPerson = await resolver.match('Person').id(person.id).save({ age: 45 });

      // Pre Query (this comes from internal #get lookup)
      query = { id: person.id, model: 'Person', op: 'findOne', key: 'getPerson', crud: 'read' };
      query.args = { id: person.id };
      query.where = { id: person.id, network: 'networkId' };
      asserter(['preQuery'], 1);

      // Post Query
      $event['query.result'] = person;
      asserter(['postQuery'], 1);

      // Pre Mutation + validate
      query = { id: person.id, model: 'Person', op: 'updateOne', key: 'updatePerson', crud: 'update', isMutation: true };
      query.args = { id: person.id, input: { age: 45 } };
      query.input = { age: 45 };
      $event['query.doc'] = person;
      $event['query.result'] = undefined;
      asserter(['preMutation', 'validate'], 1);

      // Post Mutation + Responses
      $event['query.result'] = updatedPerson;
      asserter(['postMutation'], 1);

      // Response
      asserter(['preResponse', 'postResponse'], 2, false); // Once for Query once for Mutation!
    });
  });
});
