class MyError extends Error {
  constructor(e) {
    super(e);
    this.data = e;
  }
}
exports.AbortEarlyError = class extends MyError {};
