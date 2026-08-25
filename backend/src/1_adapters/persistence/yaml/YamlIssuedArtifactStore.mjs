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
  #payload(id, extension = 'pdf') { return path.join(this.#root(), `${this.#stem(id)}.${extension}`); }

  async get(artifactId) {
    if (!validId(artifactId)) return null;
    try {
      const raw = await fs.readFile(this.#manifest(artifactId), 'utf8');
      const manifest = yaml.load(raw);
      // v1/v2 worksheet archives predate typed representations and are always
      // PDFs. v3 makes the retained original explicit so receipts can retain
      // their original raster without pretending to be Letter documents.
      const extension = manifest?.representation?.extension ?? 'pdf';
      const bytes = await fs.readFile(this.#payload(artifactId, extension));
      if (manifest?.artifactId !== artifactId || manifest?.sha256 !== digest(bytes) || manifest?.byteLength !== bytes.length) {
        throw new DomainInvariantError(`issued artifact ${artifactId} failed integrity verification`, { code: 'ARTIFACT_CORRUPT' });
      }
      return { manifest, bytes };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async put({ artifactId, bytes, pageCount = null, issuedAt, sessionId = null, sessionIds = null, learnerId = null,
    unitId = null, captureKind = 'original', worksheetInstanceId = null, allocation = null,
    kind = 'worksheet', document = null, renderContext = null, parentArtifactIds = [],
    representation = null, sourceDocument = null } = {}) {
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
      const linkedSessionIds = [...new Set([sessionId, ...(Array.isArray(sessionIds) ? sessionIds : [])].filter(Boolean))];
      const typedRepresentation = representation ? {
        mediaType: representation.mediaType ?? 'application/pdf',
        extension: representation.extension ?? 'pdf',
        width: representation.width ?? null,
        height: representation.height ?? null,
      } : null;
      if (typedRepresentation && !/^[a-z0-9]+$/i.test(typedRepresentation.extension)) {
        throw new Error('issued artifact representation extension must be alphanumeric');
      }
      const manifest = {
        // v2 is the durable session-artifact contract. v1 manifests remain
        // readable above, but every newly captured print has enough lineage
        // to be shown honestly in teacher history without rediscovering it
        // from mutable curriculum data.
        schema: typedRepresentation || sourceDocument ? 'school.session-artifact/v3' : 'school.session-artifact/v2', artifactId, kind, captureKind, sha256,
        byteLength: bytes.length, pageCount, issuedAt,
        sessionId: linkedSessionIds[0] ?? null, sessionIds: linkedSessionIds,
        learnerId, unitId,
        worksheetInstanceId, allocation: allocation ? {
          cardId: allocation.cardId ?? null, recordId: allocation.recordId ?? null,
          rowRange: allocation.rowRange ?? null,
        } : null,
        document: document ? {
          id: document.id ?? null, revision: document.rev ?? document.revision ?? null,
          title: document.title ?? null,
        } : null,
        // This is input provenance, not a live render request. It lets a
        // future compatible renderer prove that a replay is possible while
        // making an unavailable legacy render explicit rather than fictional.
        renderContext: renderContext ? structuredClone(renderContext) : null,
        ...(typedRepresentation ? { representation: typedRepresentation } : {}),
        // A receipt's document is the frozen semantic record from which a
        // compatible renderer may produce a separately labelled replay. It is
        // never reconstructed from current curriculum, review, or clock data.
        ...(sourceDocument ? { sourceDocument: structuredClone(sourceDocument) } : {}),
        parentArtifactIds: [...new Set(parentArtifactIds.filter(Boolean))],
      };
      const nonce = `${process.pid}-${Date.now()}`;
      const extension = typedRepresentation?.extension ?? 'pdf';
      const payload = this.#payload(artifactId, extension);
      const pdfTmp = `${payload}.${nonce}.tmp`;
      const manifestTmp = `${this.#manifest(artifactId)}.${nonce}.tmp`;
      await fs.writeFile(pdfTmp, bytes, { flag: 'wx' });
      await fs.writeFile(manifestTmp, yaml.dump(manifest, { lineWidth: -1, noRefs: true }), { flag: 'wx' });
      await fs.rename(pdfTmp, payload);
      await fs.rename(manifestTmp, this.#manifest(artifactId));
      return { manifest, bytes };
    };
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlIssuedArtifactStore;
