/**
 * chess.yml (snake_case) -> the component's cue flags (camelCase).
 *
 * This is the ONLY place the two spellings meet. The component reads camelCase
 * cue flags; the config and every patch the settings panel emits stay
 * snake_case. Anything else reading these keys outside this file is drift.
 *
 * Only refusal loudness lives here — the red flash on a refused square and the
 * sentence saying what was wrong. Legality marks are NOT config: they are a
 * gesture channel, drawn only when the player asks at the keys, so a stale
 * `hint_level` in a saved override is ignored rather than translated — it
 * selects behaviour that no longer exists.
 */
export function cuesFromConfig(config) {
  const feedback = config?.feedback || {};
  return {
    flashRejected: feedback.flash_rejected !== false,
    toast: feedback.toast !== false,
  };
}

export default cuesFromConfig;
