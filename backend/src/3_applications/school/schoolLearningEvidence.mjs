import { ValidationError } from '#domains/core/errors/index.mjs';
import { stableRecordDigest } from '#apps/common/stableRecord.mjs';

/** Read independent evidence sources concurrently and fail on ID collisions. */
export async function listSchoolLearningEvidence({ sources, query, logger = null }) {
  const sourceRows = await Promise.all(sources.map(async (source) => {
    try {
      const rows = await source.listEvidence(query);
      if (!Array.isArray(rows)) throw new Error('evidence source returned a non-array');
      return rows;
    } catch (error) {
      logger?.error?.('school.progress.evidence-source-failed', { error: error.message });
      throw error;
    }
  }));
  const byId = new Map();
  for (const row of sourceRows.flat()) {
    const id = row?.evidenceId;
    if (typeof id !== 'string' || !id) throw new ValidationError('School progress evidence has no evidenceId');
    const digest = stableRecordDigest(row);
    const prior = byId.get(id);
    if (prior && prior.digest !== digest) {
      throw new ValidationError(`School progress evidence collision: ${id}`);
    }
    if (!prior) byId.set(id, { digest, row });
  }
  return [...byId.values()].map(({ row }) => row);
}

export default listSchoolLearningEvidence;

