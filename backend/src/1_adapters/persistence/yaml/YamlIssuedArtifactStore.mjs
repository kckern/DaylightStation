import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const validId = (id) => typeof id === 'string' && id.trim() && id.length <= 240
  && !id.includes('\0') && !id.includes('\\') && !id.startsWith('/')
  && id.split('/').every((segment) => segment && segment !== '.' && segment !== '..');

/** Immutable exact-byte archive for School PDFs that were actually issued. */
export class YamlIssuedArtifactStore {
  #configService; #writeChain = Promise.resolve();
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlIssuedArtifactStore requires configService');
    this.#configService = configService;
  }
  #root() { return this.#configService.getHouseholdPath('school/artifacts/issued'); }
  #stem(id) { return encodeURIComponent(id); }
  #manifest(id) { return path.join(this.#root(), `${this.#stem(id)}.yml`); }
  #pdf(id) { return path.join(this.#root(), `${this.#stem(id)}.pdf`); }

  async get(artifactId) {
    if (!validId(artifactId)) return null;
    try {
      const [raw, bytes] = await Promise.all([
        fs.readFile(this.#manifest(artifactId), 'utf8'), fs.readFile(this.#pdf(artifactId)),
      ]);
      const manifest = yaml.load(raw);
      if (manifest?.artifactId !== artifactId || manifest?.sha256 !== digest(bytes) || manifest?.byteLength !== bytes.length) {
        throw new DomainInvariantError(`issued artifact ${artifactId} failed integrity verification`, { code: 'ARTIFACT_CORRUPT' });
      }
      return { manifest, bytes };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async put({ artifactId, bytes, pageCount = null, issuedAt, sessionId, learnerId = null,
    unitId = null, captureKind = 'original', worksheetInstanceId = null, allocation = null } = {}) {
    if (!validId(artifactId) || !Buffer.isBuffer(bytes)) throw new Error('issued artifact requires artifactId and Buffer bytes');
    const run = async () => {
      const existing = await this.get(artifactId);
      const sha256 = digest(bytes);
      if (existing) {
        if (existing.manifest.sha256 !== sha256) {
          throw new DomainInvariantError(`issued artifact ${artifactId} is immutable`, { code: 'ARTIFACT_IMMUTABLE' });
        }
        return existing;
      }
      await fs.mkdir(this.#root(), { recursive: true });
      const manifest = {
        schema: 'school.issued-artifact/v1', artifactId, captureKind, sha256,
        byteLength: bytes.length, pageCount, issuedAt, sessionId, learnerId, unitId,
        worksheetInstanceId, allocation: allocation ? {
          cardId: allocation.cardId ?? null, recordId: allocation.recordId ?? null,
          rowRange: allocation.rowRange ?? null,
        } : null,
      };
      const nonce = `${process.pid}-${Date.now()}`;
      const pdfTmp = `${this.#pdf(artifactId)}.${nonce}.tmp`;
      const manifestTmp = `${this.#manifest(artifactId)}.${nonce}.tmp`;
      await fs.writeFile(pdfTmp, bytes, { flag: 'wx' });
      await fs.writeFile(manifestTmp, yaml.dump(manifest, { lineWidth: -1, noRefs: true }), { flag: 'wx' });
      await fs.rename(pdfTmp, this.#pdf(artifactId));
      await fs.rename(manifestTmp, this.#manifest(artifactId));
      return { manifest, bytes };
    };
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlIssuedArtifactStore;
