const Loader = require('../../src/data/Loader');
const Resolver = require('../../src/data/Resolver');

describe('Loader', () => {
  describe('Instance', () => {
    const resolver = jest.fn(args => args * 10);
    const loader = new Loader(resolver);

    test('resolution', async () => {
      expect(await loader.load(10)).toEqual(100);
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(await loader.load(20)).toEqual(200);
      expect(resolver).toHaveBeenCalledTimes(2);

      // Cached...
      expect(await loader.load(10)).toEqual(100);
      expect(await loader.load(20)).toEqual(200);
      expect(resolver).toHaveBeenCalledTimes(2);

      loader.clear(10);
      expect(await loader.load(10)).toEqual(100);
      expect(await loader.load(20)).toEqual(200);
      expect(resolver).toHaveBeenCalledTimes(3);

      loader.clearAll();
      expect(await loader.load(10)).toEqual(100);
      expect(await loader.load(20)).toEqual(200);
      expect(resolver).toHaveBeenCalledTimes(5);
    });
  });

  describe('Resolver Proxy', () => {
    const resolver = jest.fn(args => args * 10);
    const loader = Resolver.$loader('10x', resolver);

    test('resolution', async () => {
      expect(await loader.load(10)).toEqual(100);
      expect(resolver).toHaveBeenCalledTimes(1);
      expect(await loader.load(20)).toEqual(200);
      expect(resolver).toHaveBeenCalledTimes(2);

      const $loader = global.resolver.loader('10x');
      expect(await $loader.load(10)).toEqual(100);
      expect(await $loader.load(20)).toEqual(200);
      expect(resolver).toHaveBeenCalledTimes(2);

      expect(await $loader.load(100)).toEqual(1000);
      expect(await $loader.load(200)).toEqual(2000);
      expect(resolver).toHaveBeenCalledTimes(4);
      expect(resolver).toHaveBeenCalledWith(100, global.context);
      expect(resolver).toHaveBeenCalledWith(200, global.context);
    });
  });
});
