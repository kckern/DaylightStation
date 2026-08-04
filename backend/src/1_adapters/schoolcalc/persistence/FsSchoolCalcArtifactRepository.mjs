import path from 'node:path';
import { createHash } from 'node:crypto';
import { ISchoolCalcArtifactRepository } from '#apps/school/ports/ISchoolCalcArtifactRepository.mjs';
import { DomainInvariantError } from '#domains/core/errors/index.mjs';
import {
  fileExists,
  loadYamlFromPath,
  readBinary,
  saveYamlToPathAtomic,
  writeBinaryAtomic,
} from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,127}$/;

/** Immutable artifact bytes plus server-only interpretation metadata. */
export class FsSchoolCalcArtifactRepository extends ISchoolCalcArtifactRepository {
  #directory; #io; #writeChain = Promise.resolve();

  constructor({ directory, io = {} } = {}) {
    super();
    if (typeof directory !== 'string' || !directory) throw new Error('FsSchoolCalcArtifactRepository requires directory');
    this.#directory = directory;
    this.#io = {
      exists: io.exists ?? fileExists,
      loadMetadata: io.loadMetadata ?? loadYamlFromPath,
      readBytes: io.readBytes ?? readBinary,
      saveMetadata: io.saveMetadata ?? saveYamlToPathAtomic,
      writeBytes: io.writeBytes ?? writeBinaryAtomic,
    };
  }

  async getArtifact(artifactId) {
    if (!SAFE_ID.test(artifactId || '')) return null;
    const metadata = this.#io.loadMetadata(this.#metadataPath(artifactId));
    const bytes = this.#io.readBytes(this.#bytesPath(artifactId));
    if (!metadata && !bytes) return null;
    if (!metadata || !bytes) throw corrupt(artifactId, 'metadata/byte pair is incomplete');
    verifyBytes(metadata, bytes);
    return { ...structuredClone(metadata), bytes: Buffer.from(bytes) };
  }

  async putArtifact(artifact) {
    const operation = this.#writeChain.then(async () => {
      validateIncoming(artifact);
      const existing = await this.getArtifact(artifact.artifactId);
      if (existing) {
        if (existing.byteDigest !== artifact.byteDigest || existing.sourceDigest !== artifact.sourceDigest
          || !existing.bytes.equals(Buffer.from(artifact.bytes))) {
          throw new DomainInvariantError(`SchoolCalc artifact '${artifact.artifactId}' is immutable`, {
            code: 'SCHOOLCALC_ARTIFACT_IMMUTABLE_CONFLICT',
          });
        }
        return existing;
      }

      const bytesPath = this.#bytesPath(artifact.artifactId);
      // Recover a crash after byte staging but before the metadata commit only
      // when the orphaned bytes are exactly the requested immutable payload.
      if (this.#io.exists(bytesPath)) {
        const orphan = this.#io.readBytes(bytesPath);
        if (!orphan || !Buffer.from(orphan).equals(Buffer.from(artifact.bytes))) {
          throw corrupt(artifact.artifactId, 'orphaned bytes differ from requested artifact');
        }
      } else {
        this.#io.writeBytes(bytesPath, Buffer.from(artifact.bytes));
      }
      this.#io.saveMetadata(this.#metadataPath(artifact.artifactId), metadataOf(artifact), { noRefs: true });
      return this.getArtifact(artifact.artifactId);
    });
    this.#writeChain = operation.catch(() => {});
    return operation;
  }

  #stem(artifactId) { return encodeURIComponent(artifactId); }
  #metadataPath(artifactId) { return path.join(this.#directory, `${this.#stem(artifactId)}.yml`); }
  #bytesPath(artifactId) { return path.join(this.#directory, `${this.#stem(artifactId)}.bin`); }
}

function metadataOf({ bytes: _bytes, ...metadata }) { return structuredClone(metadata); }

function validateIncoming(artifact) {
  if (!artifact || !SAFE_ID.test(artifact.artifactId || '') || !Buffer.isBuffer(artifact.bytes)) {
    throw new Error('SchoolCalc artifact requires a safe artifactId and Buffer bytes');
  }
  verifyBytes(artifact, artifact.bytes);
  if (typeof artifact.sourceDigest !== 'string' || !artifact.sourceDigest) {
    throw new Error('SchoolCalc artifact requires sourceDigest');
  }
}

function verifyBytes(metadata, bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (metadata.byteLength !== bytes.length || metadata.byteDigest !== digest) {
    throw corrupt(metadata.artifactId, 'length or SHA-256 digest does not match bytes');
  }
}

function corrupt(artifactId, reason) {
  return new DomainInvariantError(`SchoolCalc artifact '${artifactId}' is corrupt: ${reason}`, {
    code: 'SCHOOLCALC_ARTIFACT_CORRUPT',
  });
}

export default FsSchoolCalcArtifactRepository;

