/** Durable coordination state, separate from provider state and KB ownership. */
export class IWorkState {
  async read(_input) {
    throw new Error('IWorkState.read not implemented');
  }
  async transact(_input) {
    throw new Error('IWorkState.transact not implemented');
  }
  async recover(_input) {
    throw new Error('IWorkState.recover not implemented');
  }
  async close() {
    throw new Error('IWorkState.close not implemented');
  }
}
