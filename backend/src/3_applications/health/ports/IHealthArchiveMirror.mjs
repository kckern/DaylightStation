export class IHealthArchiveMirror {
  async listFiles(_sourceRoot) { throw new Error('IHealthArchiveMirror.listFiles must be implemented'); }
  async needsCopy(_request) { throw new Error('IHealthArchiveMirror.needsCopy must be implemented'); }
  async copy(_request) { throw new Error('IHealthArchiveMirror.copy must be implemented'); }
}
