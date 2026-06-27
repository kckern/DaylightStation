/**
 * launchModel — pure decision logic for what happens when a game is launched.
 *
 * Maps (saveMode, identity, whether a save exists) → a launch action. Keeps the
 * fingerprint-up-front / resume-by-default / cold-start rules in one tested
 * place, so the widget orchestration stays a thin shell around this.
 *
 * Save modes (from the catalog):
 *   'none'    — no persistence; always boots fresh & anonymous.
 *   'state'   — emulator save-state snapshot is the resume point.
 *   'battery' — .srm battery save is the resume point.
 */

export const SAVE_MODES = ['none', 'state', 'battery'];

/** True when the saveMode supports persistence (state or battery). */
export function supportsSave(saveMode) {
  return saveMode === 'state' || saveMode === 'battery';
}

/** Boot fresh + anonymous. Identity/saving is opt-in post-launch. */
export function freshLaunch() {
  return { action: 'fresh', persist: false, userId: null };
}

/** Load an identified user's existing save → resume + persist. */
export function loadLaunch(userId) {
  return { action: 'resume', persist: true, userId };
}

/** Claim the running fresh game for an identified user → keep playing + persist. */
export function claimLaunch(userId) {
  return { action: 'fresh', persist: true, userId };
}

export default { SAVE_MODES, supportsSave, freshLaunch, loadLaunch, claimLaunch };
