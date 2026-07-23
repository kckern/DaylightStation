// Pure decoder: maps numeric recorder tuples back into named event objects.
//
// The recorder (inputRecorder.js) emits a header via buildHeader() and a series
// of batches via encodeBatch(). This module reverses that encoding so a recorded
// session can be replayed as human-readable events — the "can we replay it" proof.
//
// A batch row is [t, kind, a, b, c, d]. The header carries:
//   - kinds:   { "<numericKind>": "<eventName>" }   (e.g. { "1": "midi.on" })
//   - strings: [ ...interned strings ]              (index === intern id)
//
// This module is intentionally side-effect free and dependency free.

/**
 * Look up an interned string by id, tolerating a missing/out-of-range table.
 * @param {string[]|undefined} strings
 * @param {number} id
 * @returns {string|undefined}
 */
function internedString(strings, id) {
  if (!Array.isArray(strings)) return undefined;
  return strings[id];
}

/**
 * Decode a single numeric tuple into a named event object.
 * @param {[number, number, number, number, number, number]} row
 * @param {Record<string,string>} kinds
 * @param {string[]} strings
 * @returns {object}
 */
function decodeRow(row, kinds, strings) {
  const [t, kind, a, b, c] = row;
  const event = (kinds && kinds[String(kind)]) || 'unknown';

  switch (event) {
    case 'midi.on':
    case 'midi.off':
      return { t, event, note: a, velocity: b, step: c };
    case 'sustain':
      return { t, event, down: a === 1, step: c };
    case 'cc':
      return { t, event, controller: a, value: b, step: c };
    case 'tap':
      return { t, event, control: internedString(strings, a), latencyMs: b };
    case 'touch.start':
    case 'touch.end':
      return { t, event, x: a, y: b };
    case 'touch.move':
      // Moves are replayed in a burst at pointerup, so record-time `t` is nearly
      // identical across a gesture. Slot c carries each sample's ORIGINAL time
      // (ms, page-relative) — the real time axis for velocity/shape.
      return { t, event, x: a, y: b, sampleT: c };
    case 'ui.intent':
      return { t, event, control: internedString(strings, a), step: c };
    case 'render':
      return { t, event, component: internedString(strings, a), nodes: b };
    default:
      return { t, event, a, b, c, d: row[5] };
  }
}

/**
 * Decode recorder batches into a flat, ordered array of named events.
 * @param {object} header - result of buildHeader({ session, score, ctx })
 * @param {Array<{ b: Array, dropped: number }>} batches
 * @returns {object[]} decoded events in recorded order
 */
export function decodeEvents(header, batches) {
  const kinds = (header && header.kinds) || {};
  const list = Array.isArray(batches) ? batches : [];
  // Strings can be interned AFTER the header ships (the recorder starts the header
  // before any control/component name is seen), so each batch carries the current
  // string table. Build the union: header first, then every batch's table wins /
  // accumulates by intern id, so a name is resolvable regardless of when it landed.
  const strings = [];
  const merge = (table) => {
    if (!Array.isArray(table)) return;
    for (let i = 0; i < table.length; i++) {
      if (table[i] !== undefined) strings[i] = table[i];
    }
  };
  merge(header && header.strings);
  for (const batch of list) merge(batch && batch.strings);
  const out = [];
  for (const batch of list) {
    const rows = batch && Array.isArray(batch.b) ? batch.b : [];
    for (const row of rows) {
      out.push(decodeRow(row, kinds, strings));
    }
  }
  return out;
}

/**
 * Sum the dropped counts across batches so lost stretches are observable in
 * replay rather than silently missing.
 * @param {Array<{ dropped?: number }>} batches
 * @returns {number}
 */
export function totalDropped(batches) {
  const list = Array.isArray(batches) ? batches : [];
  let sum = 0;
  for (const batch of list) {
    if (batch && Number.isFinite(batch.dropped)) sum += batch.dropped;
  }
  return sum;
}
