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
    const transformer = new Transformer({ shape: { age: [({ value }) => value * 2, ({ value }) => undefined, ({ value }) => value * 2] } });
    const data = transformer.transform({ age: 10, name: 'anne' });
    expect(data).toEqual({ age: 40, name: 'anne' });
    data.age = 11;
    expect(data).toEqual({ age: 44, name: 'anne' });
  });

  test('arrays', () => {
    const transformer = new Transformer({ shape: { tags: [({ value }) => Util.map(value, v => v.toLowerCase())] } });
    const data = transformer.transform({ tags: ['a', 'b', 'C'] });
    expect(data).toEqual({ tags: ['a', 'b', 'c'] });
    // data.tags.push('D');
    // expect(data).toEqual({ tags: ['a', 'b', 'c', 'd'] });
  });

  test('nested', () => {
    const transformer1 = new Transformer({
      shape: { name: [({ value }) => value.toLowerCase()] },
      defaults: { name: 'defaultName' },
    });

    const transformer2 = new Transformer({
      shape: { age: [({ value }) => value * 2], sections: [({ value }) => Util.map(value, v => transformer1.transform(v))] },
    });

    const data = transformer2.transform({ name: 'name', sections: [{ age: 10 }, { name: 'NAME', age: 20 }] });
    expect(data).toEqual({ name: 'name', sections: [{ name: 'defaultname', age: 10 }, { name: 'name', age: 20 }] });
  });

  test('performance', () => {
    const section = new Transformer({
      shape: { id: [({ value }) => new ObjectId(value)], name: [({ value }) => value.toLowerCase()] },
      defaults: { id: undefined, name: 'defaultName' },
    });

    const base = new Transformer({
      shape: { id: [({ value }) => new ObjectId(value)], age: [({ value }) => value * 2], sections: [({ value }) => Util.map(value, v => section.transform(v)), 'sectors'] },
      defaults: { id: undefined },
    });

    const renamer = new Transformer({
      shape: { sections: ['spectors'] },
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

    console.time('rename');
    expect(renamer.transform(data)).toEqual(expect.arrayContaining([
      { name: 'Richard1', age: 45, spectors: expect.arrayContaining([{ name: 'Section1', age: 22, state: 'GA' }]) },
      { name: 'Richard2', age: 45, spectors: expect.arrayContaining([{ name: 'Section2', age: 22, state: 'GA' }]) },
    ]));
    console.timeEnd('rename');
  });
});
