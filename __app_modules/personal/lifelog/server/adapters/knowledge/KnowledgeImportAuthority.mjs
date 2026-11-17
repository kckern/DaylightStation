import os from 'node:os';
import { importDigest, validImportManifest } from '../../domain/knowledge/importManifest.mjs';

/** Process-local authority for an explicit operator apply, separate from chat identity. */
export class KnowledgeImportAuthority {
  #configuration;
  #clock;
  #receipts = new WeakMap();
  #capabilities = new WeakMap();
  #closed = false;
  constructor({
    configuration,
    clock = Date.now
  }) {
    this.#configuration = structuredClone(configuration);
    this.#clock = clock;
  }
  get canImport() {
    const c = this.#configuration;
    return !this.#closed && c.enabled === true && c.write === true && c.importWrites === true && process.platform === 'linux' && c.writer_host === os.hostname() && c.writer_env === (process.env.DAYLIGHT_ENV || 'docker') && Number.isInteger(c.operator_uid) && c.operator_uid === process.getuid?.();
  }
  captureOperatorReceipt({
    manifest
  }) {
    if (!this.canImport || !validImportManifest(manifest) || manifest.asOf > this.#clock()) return null;
    const receipt = Object.freeze({
      kind: 'knowledge-import-operator'
    });
    this.#receipts.set(receipt, {
      manifest: importDigest(manifest),
      issuedAt: this.#clock()
    });
    return receipt;
  }
  #current(record) {
    const now = this.#clock();
    return !!record && Number.isFinite(now) && now >= record.issuedAt && now - record.issuedAt <= 15 * 60000;
  }
  authorize({
    manifest,
    operatorReceipt,
    artifactDigest,
    sourceHashes
  }) {
    const receipt = operatorReceipt && this.#receipts.get(operatorReceipt);
    if (!this.canImport || !validImportManifest(manifest) || !this.#current(receipt) || receipt.manifest !== importDigest(manifest) || !/^[a-f0-9]{64}$/.test(artifactDigest ?? '') || importDigest(sourceHashes) !== importDigest(manifest.sourceHashes)) return null;
    const capability = Object.freeze({
      kind: 'knowledge-import'
    });
    this.#capabilities.set(capability, {
      issuedAt: receipt.issuedAt,
      manifest: receipt.manifest,
      artifactDigest
    });
    return capability;
  }
  verify({
    manifest,
    artifactDigest,
    sourceHashes,
    capability
  }) {
    const record = capability && this.#capabilities.get(capability);
    return this.canImport && validImportManifest(manifest) && this.#current(record) && record.manifest === importDigest(manifest) && record.artifactDigest === artifactDigest && importDigest(sourceHashes) === importDigest(manifest.sourceHashes);
  }
  close() {
    this.#closed = true;
  }
}
