/**
 * What colour a device's square is in the Mosaic. One rule, shared with the
 * Today lanes: amber something on, blue someone there, orange something
 * open, a cool-to-warm tint for a temperature, and dark for everything
 * quiet. Attention is graded: a red outline, on top of any fill, says a
 * sensor is stuck or a battery is running low; a device not answering is
 * dimmed with a faint red hairline instead — common enough on a big install
 * that a full red ring on each would drown the ones that matter.
 */

// Things that are "on" in the sense of drawing, lighting or playing.
const ON_TYPES = new Set(['light', 'power', 'media', 'switch']);
// The span a temperature tints across, in °F: 55 reads cold, 85 hot.
const TEMP_COLD_F = 55;
const TEMP_SPAN_F = 30;

// Celsius only when the unit says so: °C, C or ℃ (never any unit with a "c" in it).
const CELSIUS = /^\s*(°\s*C|C|℃)\s*$/i;

const idOf = (item) => (typeof item === 'string' ? item : item?.entityId ?? null);
const idSet = (list) => new Set((Array.isArray(list) ? list : []).map(idOf).filter(Boolean));

/** The summary's lists as sets of entity ids (they hold ids or `{entityId}` rows). */
export function toneFlags(summary) {
  return {
    stuck: idSet(summary?.stuck),
    lowBattery: idSet(summary?.lowBattery),
    motion: idSet(summary?.motion),
    open: idSet(summary?.open),
  };
}

/** 0–100: where a reading sits between 55 °F and 85 °F; null when it is not a number. */
function temperaturePct(entity) {
  const raw = entity.state;
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null;
  let f = Number(raw);
  if (!Number.isFinite(f)) return null;
  if (CELSIUS.test(entity.unit || '')) f = f * 9 / 5 + 32;
  const t = Math.min(1, Math.max(0, (f - TEMP_COLD_F) / TEMP_SPAN_F));
  return Math.round(t * 100);
}

/**
 * @param {{id: string, type: string, stateClass: string, state: string|null, deviceClass?: string|null, unit?: string|null}} entity
 * @param {{stuck: Set<string>, lowBattery: Set<string>, motion: Set<string>, open: Set<string>}} flags
 * @returns {{fill: 'on'|'motion'|'open'|'temp'|'quiet', attention: 'stuck'|'battery'|'silent'|false, tempPct: number|null}}
 */
export function squareTone(entity, flags) {
  const stuck = flags.stuck.has(entity.id);
  let attention = false;
  if (stuck) attention = 'stuck';
  else if (flags.lowBattery.has(entity.id)) attention = 'battery';
  else if (entity.stateClass === 'unavailable') attention = 'silent';
  const on = entity.stateClass === 'on';
  let fill = 'quiet';
  let tempPct = null;
  if (entity.type === 'openings') {
    if (on || flags.open.has(entity.id)) fill = 'open';
  } else if (entity.type === 'presence') {
    // A sensor stuck "on" is not someone there; its outline says why.
    if ((on && !stuck) || flags.motion.has(entity.id)) fill = 'motion';
  } else if (ON_TYPES.has(entity.type)) {
    if (on) fill = 'on';
  } else if (entity.deviceClass === 'temperature' && entity.stateClass !== 'unavailable') {
    tempPct = temperaturePct(entity);
    if (tempPct != null) fill = 'temp';
  }
  return { fill, attention, tempPct };
}

const LIVELY = new Set(['on', 'motion', 'open']);

/** Whether a square counts toward its group's "N on". */
export function isLively(tone) {
  return LIVELY.has(tone.fill);
}

/** The attention grades drawn as the loud red ring; "silent" is the quiet one. */
export function isLoudAttention(tone) {
  return tone.attention === 'stuck' || tone.attention === 'battery';
}
