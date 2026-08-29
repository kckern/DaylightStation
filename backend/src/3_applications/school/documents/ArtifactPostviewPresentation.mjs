/** Select and format the proven assessment facts rendered on an artifact postview. */
export function prepareArtifactPostviewEvidence(session) {
  const state = session?.state ?? session ?? {};
  const activeAdjustment = [...(state.gradeAdjustments ?? [])]
    .reverse()
    .find((row) => !row.retracted) ?? null;

  return {
    machinePercent: state.machineGrade?.percent ?? null,
    effectivePercent: state.gradedPercent ?? null,
    outcome: state.outcome?.result ?? null,
    missedItemIds: [...(state.missedItemIds ?? [])],
    correction: activeAdjustment
      ? {
          reason: activeAdjustment.reason,
          adjustedBy: activeAdjustment.adjustedBy,
          date: String(activeAdjustment.at).slice(0, 10),
        }
      : null,
  };
}

export class ArtifactPostviewPresentation {
  constructor({ render }) { this.renderDocument = render; }

  render({ originalPdf, session }) {
    return this.renderDocument({
      originalPdf,
      evidence: prepareArtifactPostviewEvidence(session),
    });
  }
}

export default prepareArtifactPostviewEvidence;
