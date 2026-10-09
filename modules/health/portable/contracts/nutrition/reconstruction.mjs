/**
 * Untracked-intake reconstruction — the ONE marker.
 * @module shared/contracts/nutrition/reconstruction
 *
 * A day that was never (or only partly) logged can be backfilled with a single
 * synthetic row whose calories are the weight-derived estimate minus what was
 * logged (see docs/reference/health/README.md#untracked-intake-reconstruction).
 * Those rows share this log id — the one thing that identifies them, keeps
 * them out of protein/macro judgements, and removes all of them in one call
 * (`removeByLogId`).
 */
export const RECONSTRUCTION_LOG_ID = 'untracked-reconstruction';
export const RECONSTRUCTION_ITEM_NAME = 'Untracked (reconstructed)';

/** True when a nutrilist row is a reconstruction, not food someone logged. */
export function isReconstructedRow(row) {
  return row?.logId === RECONSTRUCTION_LOG_ID || row?.log_uuid === RECONSTRUCTION_LOG_ID;
}
