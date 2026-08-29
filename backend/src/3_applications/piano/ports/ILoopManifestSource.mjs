export class ILoopManifestSource {
  readLedger() { throw new Error('ILoopManifestSource.readLedger must be implemented'); }
  listBrickDocuments(_types) { throw new Error('ILoopManifestSource.listBrickDocuments must be implemented'); }
  signature(_types) { throw new Error('ILoopManifestSource.signature must be implemented'); }
}
