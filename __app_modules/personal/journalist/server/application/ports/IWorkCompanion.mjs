/** Optional Work coordination; Journalist never owns provider or KB mutations. */
export class IWorkCompanion {
  capturePrincipal(_input) {
    throw new Error('Not implemented');
  }
  sourceForEntry(_input) {
    throw new Error('Not implemented');
  }
  async onEntrySaved(_input) {
    throw new Error('Not implemented');
  }
  async handleCallback(_input) {
    throw new Error('Not implemented');
  }
  async open(_input) {
    throw new Error('Not implemented');
  }
}
