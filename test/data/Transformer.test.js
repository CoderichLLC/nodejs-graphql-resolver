const Util = require('@coderich/util');
const { ObjectId } = require('mongodb');
const Transformer = require('../../src/data/Transformer');

describe('Transformer', () => {
  test('identity', () => {
    const transformer = new Transformer();
    const data = transformer.transform({ age: 20 });
    expect(data.age).toBe(20);
    data.age = 22;
    expect(data.age).toBe(22);
  });

  test('multiplier', () => {
    const transformer = new Transformer({ shape: { age: [v => v * 2] } });
    const data = transformer.transform({ age: 10, name: 'anne' });
    expect(data).toEqual({ age: 20, name: 'anne' });
    data.age = 11;
    expect(data).toEqual({ age: 22, name: 'anne' });
  });

  test('nested', () => {
    const transformer1 = new Transformer({
      shape: { name: [v => v.toLowerCase()] },
      defaults: { name: 'defaultName' },
    });

    const transformer2 = new Transformer({
      shape: { age: [v => v * 2], sections: [v => Util.map(v, el => transformer1.transform(el))] },
    });

    const data = transformer2.transform({ name: 'name', sections: [{ age: 10 }, { name: 'NAME', age: 20 }] });
    expect(data).toEqual({ name: 'name', sections: [{ name: 'defaultname', age: 10 }, { name: 'name', age: 20 }] });
  });

  test('performance', () => {
    const section = new Transformer({
      shape: { id: [v => new ObjectId(v)], name: [v => v.toLowerCase()] },
      defaults: { id: undefined, name: 'defaultName' },
    });

    const base = new Transformer({
      shape: { id: [v => new ObjectId(v)], age: [v => v * 2], sections: [v => Util.map(v, el => section.transform(el)), 'sectors'] },
      defaults: { id: undefined },
    });

    const data = Array.from(new Array(1000)).map((el, i) => ({
      name: `Richard${i}`,
      age: 45,
      sections: Array.from(new Array(1000)).map((ele, j) => ({
        name: `Section${j}`,
        age: 22,
        state: 'GA',
      })),
    }));

    console.time('transform');
    expect(base.transform(data)).toEqual(expect.arrayContaining([
      { id: expect.any(ObjectId), name: 'Richard1', age: 90, sectors: expect.arrayContaining([{ id: expect.any(ObjectId), name: 'section1', age: 22, state: 'GA' }]) },
      { id: expect.any(ObjectId), name: 'Richard2', age: 90, sectors: expect.arrayContaining([{ id: expect.any(ObjectId), name: 'section2', age: 22, state: 'GA' }]) },
    ]));
    console.timeEnd('transform');
  });
});
