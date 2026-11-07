/**
 * Which channel a cue lives on, and which effects fit that channel.
 *
 *   said   speech: a word or a line (VidAngel type `mute`, or refine judged it speech)
 *   shown  something on screen (VidAngel type `skip`, or refine judged it visual)
 *   heard  a non-speech sound
 *
 * Audio effects (mute, bleep, duck) fit `said`; mute also fits `heard`. Visual
 * effects (blur, full-blur, censor-bar, pixelate, blackout) fit `shown`. Skip and
 * skip-card fit any channel.
 */

const PROSE = /\s/;

/** A label that names one word (possibly censored: "G*d", "b*tthead", "Irish bug"). */
export function isWordLabel(label) {
  const l = String(label || '').trim();
  return !!l && (!PROSE.test(l) || l.length <= 14) && !/[.!?]$/.test(l) && l.split(/\s+/).length <= 2;
}

const AUDIO = new Set(['mute', 'bleep', 'duck']);
const VISUAL = new Set(['blur', 'full-blur', 'censor-bar', 'pixelate', 'blackout']);
const KIND_MODALITY = { speech: 'said', 'speech-line': 'said', visual: 'shown', credits: 'shown', sound: 'heard' };
const SOUND_LABEL = /\b(heard|sound of|sounds? (of|can))\b/i;

/** @returns {'said'|'shown'|'heard'} */
export function cueModality(cue) {
  const kind = cue?.kind ?? cue?.refine?.kind;
  if (KIND_MODALITY[kind]) return KIND_MODALITY[kind];
  const label = String(cue?.label || '').trim();
  if (cue?.type === 'mute') return SOUND_LABEL.test(label) && !isWordLabel(label) ? 'heard' : 'said';
  if (cue?.type === 'skip') return 'shown';
  if (String(cue?.category || '').startsWith('credits/')) return 'shown';
  if (String(cue?.category || '').startsWith('language/')) return 'said';
  return 'shown';
}

/**
 * Map a profile/override effect onto the cue's channel.
 * shown + audio effect -> regional `blur` when tracked, else `full-blur`;
 * said/heard + visual effect -> `mute`; heard + bleep/duck -> `mute`.
 * @returns {string|null} the effect to use (null when none given)
 */
export function fitEffectToChannel(effect, modality, { hasRegions = false } = {}) {
  if (!effect) return null;
  if (modality === 'shown') return AUDIO.has(effect) ? (hasRegions ? 'blur' : 'full-blur') : effect;
  if (VISUAL.has(effect)) return 'mute';
  if (modality === 'heard' && (effect === 'bleep' || effect === 'duck')) return 'mute';
  return effect;
}
