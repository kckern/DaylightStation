/**
 * chess.yml (snake_case) -> the component's cue flags (camelCase).
 *
 * This is the ONLY place the two spellings meet. The component reads camelCase
 * cue flags; the config and every patch the settings panel emits stay
 * snake_case. Anything else reading these keys outside this file is drift.
 *
 * Refusal loudness lives here — the red flash on a refused square and the
 * sentence saying what was wrong — and so do the destination labels, the chord
 * names printed on the squares a held piece can reach. Labels are NOT help:
 * the double-play that lifted the piece was the request, so they are config,
 * never charged. Legality marks ARE help and are NOT config: they are a
 * gesture channel, drawn only when the player asks at the keys, so a stale
 * `hint_level` in a saved override is ignored rather than translated — it
 * selects behaviour that no longer exists.
 */
export function cuesFromConfig(config) {
  const feedback = config?.feedback || {};
  return {
    flashRejected: feedback.flash_rejected !== false,
    toast: feedback.toast !== false,
    showDestinationLabels: feedback.show_destination_labels !== false,
    // Sound. Default ON: this screen sits in front of an instrument and the
    // game was mute, so a move landing had no confirmation a player could hear
    // while looking at their hands. `!== false` like the rest, so a household
    // silences it explicitly rather than by omission.
    sound: feedback.sound !== false,
  };
}

export default cuesFromConfig;
