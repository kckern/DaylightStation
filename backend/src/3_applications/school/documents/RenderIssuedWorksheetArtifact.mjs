import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { sha256Bytes } from '#system/utils/sha256.mjs';
import { deriveIssueDate, deriveLearnerName } from './reprintContext.mjs';

const WORKSHEET_KINDS = new Set(['worksheet', 'worksheet-composition']);

function replayContext(manifest) {
  const stored = structuredClone(manifest.renderContext ?? {});
  const allocation = manifest.allocation ?? null;

  // Allocation requests are issuance-time commands. A historical view must
  // never repeat them: it draws the recorded card/rows without touching the
  // allocation store.
  delete stored.automaticCard;
  delete stored.freshCard;
  delete stored.answerSheetPolicy;
  delete stored.cardFirstUse;
  delete stored.duplex;

  if (stored.learnerName == null && manifest.learnerId) {
    stored.learnerName = deriveLearnerName(manifest.learnerId);
  }
  if (stored.date == null && manifest.issuedAt) stored.date = deriveIssueDate(manifest.issuedAt);

  if (allocation?.cardId && allocation?.rowRange?.start != null) {
    stored.cardId = allocation.cardId;
    stored.startRow = allocation.rowRange.start;
    stored.historicalCard = true;
    // New manifests preserve this explicitly. For legacy manifests, row 1 on
    // an original is the best available description of a freshly minted card;
    // continuation sheets (including User_4's rows 28–32) remain KEEP sheets.
    stored.historicalFirstUse = manifest.renderContext?.cardFirstUse
      ?? (manifest.captureKind === 'original' && allocation.rowRange.start === 1);
  }
  return stored;
}

/** Regenerate a worksheet artifact's disposable PDF projection from YAML. */
export class RenderIssuedWorksheetArtifact {
  #artifacts; #render; #printDocuments; #curriculum;

  constructor({ issuedArtifacts, renderPrintDocument, printDocuments = null, curriculum = null } = {}) {
    if (!issuedArtifacts || !renderPrintDocument) {
      throw new Error('RenderIssuedWorksheetArtifact requires issuedArtifacts and renderPrintDocument');
    }
    this.#artifacts = issuedArtifacts;
    this.#render = renderPrintDocument;
    this.#printDocuments = printDocuments;
    this.#curriculum = curriculum;
  }

  async execute({ artifactId, artifact: suppliedArtifact = null } = {}) {
    const artifact = suppliedArtifact ?? await this.#artifacts.get(artifactId);
    if (!artifact) throw new EntityNotFoundError('issued artifact', artifactId);
    const { manifest } = artifact;
    if (!WORKSHEET_KINDS.has(manifest.kind ?? 'worksheet')) {
      throw new ValidationError('artifact is not a worksheet PDF');
    }

    const document = manifest.sourceDocument ?? await this.#resolveLegacyDocument(manifest);
    if (!document) {
      // A v1/v2 archive can predate semantic capture. Keep it readable, but
      // label the result honestly: this is compatibility, not regeneration.
      if (Buffer.isBuffer(artifact.bytes)) {
        return {
          bytes: artifact.bytes,
          pageCount: manifest.pageCount ?? null,
          duplex: manifest.renderContext?.duplex ?? null,
          sha256: manifest.sha256 ?? sha256Bytes(artifact.bytes),
          generated: false,
        };
      }
      throw new ValidationError(`artifact '${manifest.artifactId}' has no reproducible worksheet source`, {
        code: 'ARTIFACT_SOURCE_UNAVAILABLE', details: { artifactId: manifest.artifactId },
      });
    }

    const rendered = await this.#render.execute({ document, context: replayContext(manifest) });
    return {
      ...rendered,
      sha256: sha256Bytes(rendered.bytes),
      generated: true,
    };
  }

  async #resolveLegacyDocument(manifest) {
    const id = manifest.document?.id;
    if (!id) return null;
    const revision = manifest.document?.revision ?? manifest.document?.rev ?? null;
    const published = await this.#printDocuments?.getPublished?.(id, revision);
    if (published) return published;
    const authored = await this.#printDocuments?.get?.(id);
    if (authored) return authored;
    return this.#curriculum?.getDocument?.(id) ?? null;
  }
}

export default RenderIssuedWorksheetArtifact;
