export class IComputeSandbox {
  evaluate(_expression, _inputs = {}) {
    throw new Error('IComputeSandbox.evaluate must be implemented');
  }
}
