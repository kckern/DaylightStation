/**
 * chess.yml (snake_case, hint_level) -> the component's cue flags (camelCase).
 *
 * This is the ONLY place the two spellings meet. The component reads camelCase
 * cue flags; the config and every patch the settings panel emits stay
 * snake_case. Anything else reading `hint_level` outside this file is drift.
 *
 * Hint level is one three-way answer to "how much does the board show me":
 * `off` never shows the legality cues, `after-mistake` shows them only once a
 * chord has been refused (gateOnMistake), `always` shows them ungated.
 */
const HINT_CUES = {
  off: { highlightSources: false, highlightTargets: false, gateOnMistake: false },
  'after-mistake': { highlightSources: true, highlightTargets: true, gateOnMistake: true },
  always: { highlightSources: true, highlightTargets: true, gateOnMistake: false },
};

export function cuesFromConfig(config) {
  const feedback = config?.feedback || {};
  const hint = HINT_CUES[feedback.hint_level] || HINT_CUES['after-mistake'];
  return {
    ...hint,
    flashRejected: feedback.flash_rejected !== false,
    toast: feedback.toast !== false,
  };
}

export default cuesFromConfig;
