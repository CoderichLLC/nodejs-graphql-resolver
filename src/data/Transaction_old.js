const TreeMap = require('./TreeMap');
const QueryBuilderTransaction = require('../query/QueryBuilderTransaction');

module.exports = class Transaction {
  constructor(config) {
    this.data = [];
    this.config = config;
    this.resolver = config.resolver;
    this.sourceMap = new Map();
    this.txnMap = config.parentTxn?.txnMap || this.#makeMap(this.resolver);
    this.txnMap.add(config.parentTxn, this);
  }

  match(mixed) {
    const model = this.resolver.toModelMarked(mixed);
    if (!this.sourceMap.has(model.source)) this.sourceMap.set(model.source, []);
    const op = new QueryBuilderTransaction({ ...this.config, query: { model, transaction: this } });
    this.sourceMap.get(model.source).push(op);
    return op;
  }

  exec() {
    return Promise.all(Array.from(this.sourceMap.entries()).map(([source, ops]) => {
      return source.supports?.includes('transactions') ? source.client.transaction(ops) : Promise.all(ops.map(op => op.exec())).then((results) => {
        console.log(ops);
        results.$commit = () => this.resolver.clearAll();
        results.$rollback = () => this.resolver.clearAll();
        return results;
      });
    })).then((results) => {
      this.data = results;
      return results.flat();
    });
  }

  run() {
    return this.exec().then((results) => {
      if (this.txnMap.root(this) === this) return this.commit().then(() => results);
      this.commit();
      return results;
    }).catch((e) => {
      if (this.txnMap.root(this) === this) return this.rollback().then(() => Promise.reject(e));
      this.rollback();
      throw e;
    });
  }

  commit() {
    if (this.marker !== 'rollback') this.marker = 'commit';
    return this.txnMap.perform();
  }

  rollback() {
    this.marker = 'rollback';
    return this.txnMap.perform();
  }

  #makeMap() {
    let resolve, reject;
    const map = new TreeMap();
    map.promise = new Promise((good, bad) => { resolve = good; reject = bad; });
    map.resolve = resolve;
    map.reject = reject;

    map.ready = () => {
      const elements = map.elements();
      const notReady = elements.filter(el => !el.marker);
      if (notReady.length) return [undefined, undefined];
      let rollbackIndex = elements.findIndex(el => el.marker === 'rollback');
      if (rollbackIndex === -1) rollbackIndex = Infinity;
      return [elements.slice(0, rollbackIndex), elements.slice(rollbackIndex)];
    };

    map.perform = () => {
      const [commits, rollbacks] = map.ready();

      if (commits && rollbacks) {
        const rollbackData = rollbacks.map(tnx => tnx.data).flat();
        const commitData = commits.map(tnx => tnx.data).flat();

        Promise.all(rollbackData.map(rbd => rbd.$rollback())).then(() => {
          if (commits.length) this.resolver.clearAll();
          Promise.all(commitData.map(cd => cd.$commit())).then(d => map.resolve(d));
        }).catch(e => map.reject(e));
      }

      return map.promise;
    };

    return map;
  }
};
