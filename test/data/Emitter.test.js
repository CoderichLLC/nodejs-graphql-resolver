const Emitter = require('../../src/data/Emitter');

describe('Emitter', () => {
  test('on', () => {
    const fn = jest.fn();
    Emitter.on('on', fn);
    Emitter.emit('on');
    Emitter.emit('on');
    expect(fn).toBeCalledTimes(2);
  });

  test('once', () => {
    const fn = jest.fn();
    Emitter.once('once', fn);
    Emitter.emit('once');
    Emitter.emit('once');
    expect(fn).toBeCalledTimes(1);
  });

  test('onKeys', () => {
    const fn = jest.fn();
    Emitter.onKeys('onKeys', 'key', fn);
    Emitter.emit('onKeys', { query: { key: 'key' } });
    Emitter.emit('onKeys', { query: { key: 'miss' } });
    Emitter.emit('onKeys', { query: { key: 'key' } });
    expect(fn).toBeCalledTimes(2);
  });

  test('onceKeys', () => {
    const fn = jest.fn();
    Emitter.onceKeys('onceKeys', 'key', fn);
    Emitter.emit('onceKeys', { query: { key: 'miss' } }); // Keep this miss first in the test
    Emitter.emit('onceKeys', { query: { key: 'key' } });
    Emitter.emit('onceKeys', { query: { key: 'key' } });
    expect(fn).toBeCalledTimes(1);
  });

  test('onModels', () => {
    const fn = jest.fn();
    Emitter.onModels('onModels', 'key', fn);
    Emitter.emit('onModels', { query: { model: 'key' } });
    Emitter.emit('onModels', { query: { model: 'miss' } });
    Emitter.emit('onModels', { query: { model: 'key' } });
    expect(fn).toBeCalledTimes(2);
  });

  test('onceModels', () => {
    const fn = jest.fn();
    Emitter.onceModels('onceModels', 'key', fn);
    Emitter.emit('onceModels', { query: { model: 'miss' } }); // Keep this miss first in the test
    Emitter.emit('onceModels', { query: { model: 'key' } });
    Emitter.emit('onceModels', { query: { model: 'key' } });
    expect(fn).toBeCalledTimes(1);
  });
});
