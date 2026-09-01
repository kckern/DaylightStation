/** Issued-artifact reads, retained-byte views, authorization, and reprints. */
export class SchoolArtifactService {
  constructor({
    issuedArtifactStore = null, renderWorksheetThumbnail = null,
    renderIssuedArtifact = null,
    renderArtifactPostview = null, getTeacherSession = null,
    teacherCapabilitySessions = null, reprintIssuedArtifact = null,
    reprintResultReceiptArtifact = null,
  } = {}) {
    Object.assign(this, {
      issuedArtifactStore, renderWorksheetThumbnail, renderIssuedArtifact, renderArtifactPostview,
      getTeacherSession, teacherCapabilitySessions, reprintIssuedArtifact,
      reprintResultReceiptArtifact,
    });
  }

  isConfigured() { return Boolean(this.issuedArtifactStore); }
  async get(artifactId) { return this.issuedArtifactStore?.get?.(artifactId) ?? null; }

  async pdf(artifactId) {
    if (!this.issuedArtifactStore) return { kind: 'unconfigured' };
    const artifact = await this.get(artifactId);
    if (!artifact) return { kind: 'not_found' };
    const mediaType = artifact.manifest.representation?.mediaType ?? 'application/pdf';
    if (mediaType !== 'application/pdf') return { kind: 'wrong_media_type' };
    if (this.renderIssuedArtifact) {
      const rendered = await this.renderIssuedArtifact.execute({ artifactId, artifact });
      return { kind: 'rendered', ...rendered };
    }
    if (Buffer.isBuffer(artifact.bytes)) return { kind: 'legacy', bytes: artifact.bytes };
    return { kind: 'unrenderable' };
  }

  async thumbnail(artifactId) {
    if (!this.issuedArtifactStore || !this.renderWorksheetThumbnail) return { kind: 'unconfigured' };
    const pdf = await this.pdf(artifactId);
    if (!['rendered', 'legacy'].includes(pdf.kind)) return pdf;
    try { return { kind: 'rendered', bytes: await this.renderWorksheetThumbnail(pdf.bytes) }; }
    catch { return { kind: 'unrenderable' }; }
  }

  async reprint({ artifactId, ...command }) {
    if (!this.issuedArtifactStore) return { kind: 'store_unconfigured' };
    const artifact = await this.get(artifactId);
    if (!artifact) return { kind: 'not_found' };
    const useCase = ['result-receipt', 'result-correction'].includes(artifact.manifest.kind)
      ? this.reprintResultReceiptArtifact : this.reprintIssuedArtifact;
    if (!useCase) return { kind: 'reprint_unconfigured' };
    return { kind: 'completed', receipt: await useCase.execute({ artifactId, ...command }) };
  }

  async postview(artifactId, proof) {
    if (!this.issuedArtifactStore || !this.getTeacherSession || !this.renderArtifactPostview) return { kind: 'unconfigured' };
    const artifact = await this.get(artifactId);
    if (!artifact) return { kind: 'not_found' };
    const sessionStatus = this.teacherCapabilitySessions?.status(proof?.capabilityToken);
    if (!sessionStatus?.active || !this.teacherCapabilitySessions.authorize({
      ...proof, userId: sessionStatus.userId, action: 'artifact.postview', context: { artifactId },
    })) return { kind: 'forbidden' };
    const pdf = await this.pdf(artifactId);
    if (!['rendered', 'legacy'].includes(pdf.kind)) return pdf;
    const session = await this.getTeacherSession.execute({ sessionId: artifact.manifest.sessionId });
    return { kind: 'rendered', ...(await this.renderArtifactPostview({ originalPdf: pdf.bytes, session })) };
  }
}

export default SchoolArtifactService;
