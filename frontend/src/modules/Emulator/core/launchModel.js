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

/** A save-enabled game requires identifying the player up front (fingerprint). */
export function requiresIdentity(saveMode) {
  return saveMode === 'state' || saveMode === 'battery';
}

/**
 * Resolve the launch action.
 *
 * @param {object} opts
 * @param {string} opts.saveMode  'none' | 'state' | 'battery'
 * @param {string|null} opts.userId  identified player, or null if anonymous/cancelled
 * @param {boolean} opts.hasSave   whether a stored save exists for this user+game
 * @returns {{ action: 'fresh'|'resume'|'cold', persist: boolean, userId: string|null }}
 *   - action 'fresh'  : boot a new game from power-on
 *   - action 'resume' : load the user's existing save
 *   - action 'cold'   : boot fresh, anonymous, never persist (fingerprint declined)
 *   - persist         : whether progress should be saved on exit / via save actions
 */
export function resolveLaunch({ saveMode = 'none', userId = null, hasSave = false } = {}) {
  if (!requiresIdentity(saveMode)) {
    // No-save game: always anonymous, never persists.
    return { action: 'fresh', persist: false, userId: null };
  }
  if (!userId) {
    // Save-enabled but no identity (cancelled / unrecognized) → cold start.
    return { action: 'cold', persist: false, userId: null };
  }
  // Identified: resume by default when a save exists, else a fresh game; either
  // way progress persists under this user.
  return { action: hasSave ? 'resume' : 'fresh', persist: true, userId };
}

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

export default { SAVE_MODES, requiresIdentity, resolveLaunch, supportsSave, freshLaunch, loadLaunch, claimLaunch };
