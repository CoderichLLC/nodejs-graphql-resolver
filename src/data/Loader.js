const get = require('lodash.get');
const Util = require('@coderich/util');
const DataLoader = require('dataloader');
const { hashObject } = require('../service/AppService');

module.exports = class Loader {
  #model;
  #loader;

  constructor(model) {
    this.#model = model;
    model.loader.cacheKeyFn = model.loader.cacheKeyFn ?? (query => hashObject(query.toCacheKey()));
    this.#loader = new DataLoader(keys => this.#resolve(keys), model.loader);
  }

  clearAll() {
    return this.#loader.clearAll();
  }

  resolve(query) {
    return this.#loader.load(query);
  }

  #resolve(queries) {
    return Promise.all(queries.map((query) => {
      const dquery = query.toDriver();
      const $query = dquery.toObject();

      return this.#model.source.client.resolve($query).then((data) => {
        if (data == null) return null; // Explicit return null;
        if ($query.isCursorPaging) return Loader.#paginateResults(data, query.toObject());
        return data;
      });
    }));
  }

  static #paginateResults(rs, query) {
    let hasNextPage = false;
    let hasPreviousPage = false;
    const { first, after, last, before, sort = {} } = query;
    const sortPaths = Object.keys(Util.flatten(sort, { safe: true }));
    const limiter = first || last;

    // Add $cursor data
    Util.map(rs, (doc) => {
      const sortValues = sortPaths.reduce((prev, path) => Object.assign(prev, { [path]: get(doc, path) }), {});
      Object.defineProperty(doc, '$cursor', { value: Buffer.from(JSON.stringify(sortValues)).toString('base64') });
    });

    // First try to take off the "bookends" ($gte | $lte)
    if (rs.length && rs[0].$cursor === after) {
      rs.shift();
      hasPreviousPage = true;
    }

    if (rs.length && rs[rs.length - 1].$cursor === before) {
      rs.pop();
      hasNextPage = true;
    }

    // Next, remove any overage
    const overage = rs.length - (limiter - 2);

    if (overage > 0) {
      if (first) {
        rs.splice(-overage);
        hasNextPage = true;
      } else if (last) {
        rs.splice(0, overage);
        hasPreviousPage = true;
      } else {
        rs.splice(-overage);
        hasNextPage = true;
      }
    }

    // Add $pageInfo
    return Object.defineProperties(rs, {
      $pageInfo: {
        get() {
          return {
            startCursor: get(rs, '0.$cursor', ''),
            endCursor: get(rs, `${rs.length - 1}.$cursor`, ''),
            hasPreviousPage,
            hasNextPage,
          };
        },
      },
    });
  }
};
