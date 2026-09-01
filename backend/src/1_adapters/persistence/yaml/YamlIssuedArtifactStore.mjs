import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import {
  ensureDir, readBinaryFromPath, readTextFromPath, renameFile, writeBinaryExclusive, writeFileExclusive,
} from '#system/utils/FileIO.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const WORKSHEET_KINDS = new Set(['worksheet', 'worksheet-composition']);
const renderInputDigest = (value) => digest(Buffer.from(yaml.dump(value, {
  sortKeys: true, lineWidth: -1, noRefs: true,
})));
const validId = (id) => typeof id === 'string' && id.trim() && id.length <= 240
  && !id.includes('\0') && !id.includes('\\') && !id.startsWith('/')
  && id.split('/').every((segment) => segment && segment !== '.' && segment !== '..');

/** Durable YAML records for issued work; worksheet PDFs are runtime projections. */
export class YamlIssuedArtifactStore {
  #configService; #writeChain = Promise.resolve();
  constructor({ configService } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlIssuedArtifactStore requires configService');
    this.#configService = configService;
  }
  #root() { return this.#configService.getHouseholdPath('school/artifacts/issued'); }

  /**
   * Artifact id -> path, per SEGMENT rather than whole-id.
   *
   * `encodeURIComponent(id)` flattened a genuinely hierarchical id into one
   * percent-encoded filename, so a single directory held entries like
   * `receipt%2Fses_hmSsHlJR%2Fout%3Ases_hmSsHlJR.yml`. The ids were never the
   * problem — the mapping was. `/` is a real separator here; within a segment,
   * `[A-Za-z0-9._-]` passes through and anything else percent-encodes, which
   * keeps the mapping deterministic and injective for every id, old and new,
   * while leaving no encoding at all on ids written in the new grammar.
   *
   * Colons survive as `%3A` inside a leaf name — a bounded, visible legacy tail
   * on the handful of `out:ses_X` receipt ids already minted. Those ids are
   * frozen: `out:ses_X` was handed to the economy ledger, so history cannot be
   * rewritten. Only where the bytes LIVE changes.
   */
  #stem(id) {
    return id.split('/')
      .map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, (ch) => encodeURIComponent(ch)))
      .join(path.sep);
  }

  /** The pre-2026-08-26 flat mapping, still read so nothing already on disk is lost. */
  #legacyStem(id) { return encodeURIComponent(id); }

  #manifest(id) { return path.join(this.#root(), `${this.#stem(id)}.yml`); }
  #payload(id, extension = 'pdf') { return path.join(this.#root(), `${this.#stem(id)}.${extension}`); }
  #legacyManifest(id) { return path.join(this.#root(), `${this.#legacyStem(id)}.yml`); }
  #legacyPayload(id, extension = 'pdf') { return path.join(this.#root(), `${this.#legacyStem(id)}.${extension}`); }

  /**
   * Read a file from the new location, falling back to the legacy flat one.
   *
   * DUAL-READ IS THE WHOLE SAFETY STORY of this change: every artifact already
   * on disk stays exactly where it is and keeps resolving, so no teacher link
   * can 404 and no migration has to run before this ships. Only NEW writes land
   * in the new shape.
   */
  async #readEither(newPath, legacyPath, encoding) {
    try {
      return encoding ? readTextFromPath(newPath) : readBinaryFromPath(newPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return encoding ? readTextFromPath(legacyPath) : readBinaryFromPath(legacyPath);
    }
  }

  async get(artifactId) {
    if (!validId(artifactId)) return null;
    try {
      const raw = await this.#readEither(
        this.#manifest(artifactId), this.#legacyManifest(artifactId), 'utf8',
      );
      const manifest = yaml.load(raw);
      if (manifest?.representation?.generated === true) {
        const expected = renderInputDigest({
          sourceDocument: manifest.sourceDocument,
          renderContext: manifest.renderContext ?? null,
          allocation: manifest.allocation ?? null,
          worksheetInstanceId: manifest.worksheetInstanceId ?? null,
        });
        if (manifest.renderInputSha256 !== expected) {
          throw new DomainInvariantError(`issued artifact ${artifactId} failed input integrity verification`, { code: 'ARTIFACT_CORRUPT' });
        }
        return { manifest, bytes: null };
      }
      // v1/v2 worksheet archives predate typed representations and are always
      // PDFs. v3 makes the retained original explicit so receipts can retain
      // their original raster without pretending to be Letter documents.
      const extension = manifest?.representation?.extension ?? 'pdf';
      let bytes;
      try {
        bytes = await this.#readEither(
          this.#payload(artifactId, extension), this.#legacyPayload(artifactId, extension), null,
        );
      } catch (error) {
        // Worksheet YAML is sufficient for current-engine regeneration. Old
        // manifests did not mark the representation as generated, so missing
        // redundant PDF bytes must not make their recipe disappear.
        if (error?.code === 'ENOENT' && WORKSHEET_KINDS.has(manifest?.kind ?? 'worksheet')) {
          return { manifest, bytes: null };
        }
        throw error;
      }
      if (manifest?.artifactId !== artifactId) {
        throw new DomainInvariantError(`issued artifact ${artifactId} failed integrity verification`, { code: 'ARTIFACT_CORRUPT' });
      }
      if (manifest?.sha256 !== digest(bytes) || manifest?.byteLength !== bytes.length) {
        // Old worksheet PDFs are disposable compatibility data now. A bad or
        // partial payload must not prevent the intact YAML recipe from being
        // rendered; retained receipt rasters still enforce byte integrity.
        if (WORKSHEET_KINDS.has(manifest?.kind ?? 'worksheet')) return { manifest, bytes: null };
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
    const mediaType = representation?.mediaType ?? 'application/pdf';
    const generatedPdf = WORKSHEET_KINDS.has(kind) && mediaType === 'application/pdf';
    if (!validId(artifactId) || (!generatedPdf && !Buffer.isBuffer(bytes))) {
      throw new Error('issued artifact requires artifactId and bytes for a retained representation');
    }
    if (generatedPdf && (!sourceDocument || typeof sourceDocument !== 'object')) {
      throw new Error('generated worksheet artifact requires sourceDocument');
    }
    const run = async () => {
      const existing = await this.get(artifactId);
      const sha256 = Buffer.isBuffer(bytes) ? digest(bytes) : null;
      const renderInputSha256 = generatedPdf ? renderInputDigest({
        sourceDocument, renderContext: renderContext ?? null, allocation: allocation ?? null,
        worksheetInstanceId: worksheetInstanceId ?? null,
      }) : null;
      if (existing) {
        const same = generatedPdf
          ? existing.manifest.renderInputSha256 === renderInputSha256
          : existing.manifest.sha256 === sha256;
        // Legacy byte archives remain readable and are never overwritten in
        // place. A later migration can promote their YAML after verification.
        if (generatedPdf && existing.manifest.renderInputSha256 == null && Buffer.isBuffer(existing.bytes)) {
          return existing;
        }
        if (!same) {
          throw new DomainInvariantError(`issued artifact ${artifactId} is immutable`, { code: 'ARTIFACT_IMMUTABLE' });
        }
        return existing;
      }
      // The id is hierarchical now, so the leaf's own directory has to exist —
      // `mkdir(root)` alone was enough only while every artifact was one flat
      // percent-encoded filename.
      ensureDir(path.dirname(this.#manifest(artifactId)));
      const linkedSessionIds = [...new Set([sessionId, ...(Array.isArray(sessionIds) ? sessionIds : [])].filter(Boolean))];
      const typedRepresentation = representation || generatedPdf ? {
        mediaType,
        extension: representation?.extension ?? 'pdf',
        width: representation?.width ?? null,
        height: representation?.height ?? null,
        ...(generatedPdf ? { generated: true } : {}),
      } : null;
      if (typedRepresentation && !/^[a-z0-9]+$/i.test(typedRepresentation.extension)) {
        throw new Error('issued artifact representation extension must be alphanumeric');
      }
      const manifest = {
        // v4 is the YAML-only worksheet contract. Older byte-backed manifests
        // remain readable above; non-PDF receipt representations stay v3.
        schema: generatedPdf ? 'school.session-artifact/v4'
          : (typedRepresentation || sourceDocument ? 'school.session-artifact/v3' : 'school.session-artifact/v2'),
        artifactId, kind, captureKind,
        ...(generatedPdf ? { renderInputSha256 } : { sha256, byteLength: bytes.length }),
        pageCount, issuedAt,
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
        // This is a recorded render request. Runtime views replace allocation
        // commands with historicalCard before invoking the current engine.
        renderContext: renderContext ? structuredClone(renderContext) : null,
        ...(typedRepresentation ? { representation: typedRepresentation } : {}),
        // For worksheets this is the durable PDF input; for receipts it is the
        // frozen semantic record used by their separately labelled replay.
        ...(sourceDocument ? { sourceDocument: structuredClone(sourceDocument) } : {}),
        parentArtifactIds: [...new Set(parentArtifactIds.filter(Boolean))],
      };
      const nonce = `${process.pid}-${Date.now()}`;
      const manifestTmp = `${this.#manifest(artifactId)}.${nonce}.tmp`;
      if (generatedPdf) {
        writeFileExclusive(manifestTmp, yaml.dump(manifest, { lineWidth: -1, noRefs: true }));
        renameFile(manifestTmp, this.#manifest(artifactId));
        return { manifest, bytes: null };
      }
      const extension = typedRepresentation?.extension ?? 'pdf';
      const payload = this.#payload(artifactId, extension);
      const payloadTmp = `${payload}.${nonce}.tmp`;
      writeBinaryExclusive(payloadTmp, bytes);
      writeFileExclusive(manifestTmp, yaml.dump(manifest, { lineWidth: -1, noRefs: true }));
      renameFile(payloadTmp, payload);
      renameFile(manifestTmp, this.#manifest(artifactId));
      return { manifest, bytes };
    };
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlIssuedArtifactStore;
