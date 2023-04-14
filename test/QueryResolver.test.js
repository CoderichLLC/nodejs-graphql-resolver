const Path = require('path');
const Schema = require('../src/Schema');
const QueryResolver = require('../src/QueryResolver');

describe('QueryResolver', () => {
  const schema = new Schema(Path.join(__dirname, 'schema.graphql')).parse();
  const resolver = { resolve: query => query };
  const factory = query => new QueryResolver({ resolver, schema, query });

  test('Query syntax', () => {
    expect(factory({ model: 'Author' }).id(1).one()).toMatchObject({ model: 'Author', op: 'findOne', where: { _id: 1 }, select: { _id: true, authored: true, biography: true, name: true, telephone: true } });
    expect(factory({ model: 'Library' }).id(1).one()).toMatchObject({ model: 'Library', op: 'findOne', where: { _id: 1 }, select: { _id: true, name: true, books: true } });
    expect(factory({ model: 'Book' }).id(1).one()).toMatchObject({ model: 'Book', op: 'findOne', where: { id: 1 }, select: { name: true, author: true } });
    expect(factory({ model: 'Author' }).select('id').where({ id: 2, name: 'rich', bio: 'amaze' }).one()).toMatchObject({ model: 'Author', op: 'findOne', where: { _id: 2, name: 'rich', biography: 'amaze' }, select: { _id: true } });
    expect(factory({ model: 'Author' }).many()).toMatchObject({ model: 'Author', op: 'findMany', select: { _id: true, name: true, biography: true, authored: true } });
  });

  // test('.clone + .query()', () => {
  //   const query = resolver.match('Author').id(1);
  //   const queryClone = query.clone({ id: 2, where: { name: 'rich' } });
  //   expect(query.one()).toEqual({ model: 'Author', op: 'findOne', where: { _id: 1 } });
  //   expect(queryClone.one()).toEqual({ model: 'Author', op: 'findOne', where: { _id: 1, name: 'rich' } });
  //   expect(resolver.query(queryClone)).toEqual({ model: 'Library', op: 'findOne', where: { _id: 2, name: 'rich' } });
  // });

  // test('ID manipulation', () => {
  //   expect(query.clone().id(1).one()).toEqual({ op: 'findOne', model: 'table', where: { _id: 1 } });
  //   expect(query.clone().where({ id: 1 }).one()).toEqual({ op: 'findOne', model: 'table', where: { id: 1 } });
  //   expect(query.clone().where({ network: { id: 1 } }).one()).toEqual({ op: 'findOne', model: 'table', where: { network: { id: 1 } } });
  //   expect(query.clone().where({ 'network.id': 1 }).one()).toEqual({ op: 'findOne', model: 'table', where: { 'network.id': 1 } });
  //   expect(query.clone().where({ networkid: 1 }).one()).toEqual({ op: 'findOne', model: 'table', where: { networkid: 1 } });
  //   expect(query.clone().where({ 'my.array': { $in: ['a', 'b', 'c'] } }).one()).toEqual({ op: 'findOne', model: 'table', where: { 'my.array': { $in: ['a', 'b', 'c'] } } });
  //   expect(query.clone().where({ 'my.array.$in': ['a', 'b', 'c'] }).one()).toEqual({ op: 'findOne', model: 'table', where: { 'my.array.$in': ['a', 'b', 'c'] } });
  //   expect(query.clone().where({ $or: [{ id: 1 }, { network: { id: 2 } }] }).one()).toEqual({ op: 'findOne', model: 'table', where: { $or: [{ id: 1 }, { network: { id: 2 } }] } });
  //   expect(query.clone().where({ $or: [{ id: 1 }, { 'network.id': 2 }] }).one()).toEqual({ op: 'findOne', model: 'table', where: { $or: [{ id: 1 }, { 'network.id': 2 }] } });
  // });
});
