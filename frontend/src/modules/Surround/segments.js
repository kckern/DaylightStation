// frontend/src/modules/Surround/segments.js
//
// Pure mapping in the direction the backend's `segments[]` doesn't already
// give us: given where the player actually IS -- one media item and a
// position inside it -- say which segment is current, and where that lands
// on the container's sounding-time rail. No React, no I/O; Task 6 (the rail)
// and Task 8 (segment transport) both build on this, so its contract matters
// more than its size.
//
// THE TIE-BREAK was decided once, on the backend, for the whole container --
// see the JSDoc on `withOffsets` in
// backend/src/1_adapters/content/surround/segments.mjs -- and is implemented
// here exactly, not re-decided:
//
//   A segment owns the half-open interval [offset, offset + duration). Where
//   several segments share one offset, the LAST of them wins. A zero-width
//   segment's interval is empty, so it is never current for any position. A
//   position landing exactly on a boundary belongs to the segment that is
//   STARTING, not the one that just ended.
//
// Offsets can only repeat when every segment between the ties has zero
// duration -- the rail only advances when a segment actually contributes
// sounding width -- so a tie is always "one or more untimed segments, then
// at most one real one starting where they were parked." That's the ordinary
// case (a trailing segment with no authored `musicEndsAt`, sitting on a part
// boundary). Genuine overlap of two REAL segments is rarer -- it only
// happens with hand-authored `spans:` -- but the same rule resolves it: scan
// forward and keep the LAST containing match rather than returning on the
// first. Returning early is the tempting shortcut and the wrong one: at a
// part boundary it would still happen to land on the right segment (the
// untimed one never matches), but the moment two real spans genuinely
// overlap it silently reports the wrong one.

/**
 * Identity keys, in the order `playerSessionBridge.normalizePlayableItem` reads
 * them. `plex` sits below `id`/`assetId` deliberately: it carries a bare rating
 * key ('663134') where the others carry the addressable id ('plex:663134'), and
 * segments are stamped with the addressable one.
 */
const ID_KEYS = ['contentId', 'assetId', 'id', 'plex', 'key'];

/**
 * Which media item a payload names — the `contentId` every segment is stamped
 * with, read off whatever shape the item arrived in.
 *
 * Two callers need the same answer from the same objects: the host, deciding
 * which item is on screen, and the transport, deciding which segments are
 * seekable from here. Two copies of this would be two ways to be on a different
 * item than the rail says.
 */
export function resolveContentId(item) {
  if (item == null) return null;
  if (typeof item === 'string' || typeof item === 'number') {
    const s = String(item);
    return s.length > 0 ? s : null;
  }
  if (typeof item !== 'object') return null;
  for (const k of ID_KEYS) {
    const v = item[k];
    if (v != null && String(v).length > 0) return String(v);
  }
  return null;
}

export function segmentAt({ segments, contentId, position }) {
  const id = String(contentId ?? '');
  const list = Array.isArray(segments) ? segments : [];

  let matchIndex = -1;
  let matchGlobal = 0;
  // Sounding time already elapsed for THIS item as of `position`, given no
  // segment of it is currently sounding. Dead time is real state -- applause
  // before the first segment, a pause between two, or the tail after the
  // last -- and this is what the band renders while nothing sounds.
  let deadGlobal = 0;
  let sawOwned = false;

  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (String(c.contentId) !== id) continue;

    if (!sawOwned) {
      // Before this item's own first segment is reached, the sounding total
      // is whatever the rail had already accumulated by the time this item's
      // music starts -- that segment's own offset, not 0. This is what makes
      // lead-in dead time (e.g. applause before a work's first segment) report
      // correctly even when the item isn't first in the container.
      deadGlobal = c.offset;
      sawOwned = true;
    }

    const hasTiming = c.start !== undefined && c.end !== undefined;

    if (hasTiming && position >= c.start && position < c.end) {
      // Do not return here. A later segment of the same item that also
      // contains `position` must overwrite this one -- the LAST match wins.
      matchIndex = i;
      matchGlobal = c.offset + (position - c.start);
      continue;
    }

    if (hasTiming && position >= c.end) {
      deadGlobal = c.offset + c.duration;
    }
  }

  if (matchIndex !== -1) return { index: matchIndex, globalSeconds: matchGlobal };
  return { index: -1, globalSeconds: deadGlobal };
}

/* -------------------------------------------------------------------------- */
/* WHAT THE BAND TALKS ABOUT WHILE ONE SEGMENT OF A CONTAINER SOUNDS           */
/* -------------------------------------------------------------------------- */

const isText = (s) => typeof s === 'string' && s.trim().length > 0;
const texts = (v) => (Array.isArray(v) ? v.filter(isText) : []);

/**
 * IS THIS PAYLOAD A CONTAINER — a rail composed from more than one media item?
 *
 * THE GATE FOR EVERYTHING BELOW, and it exists because of the Eroica. A single
 * work's segments carry `note` too (the corpus authors one per movement, and
 * the store already docks each as a timed cue at its own second), so a piece
 * register that followed the segment on ANY payload would replace that
 * symphony's fourteen programme facts with one line about the funeral march —
 * an unasked change to a shipped design, on the one payload this wave promised
 * to leave alone.
 *
 * A container is what this wave added: several works, several media items, one
 * rail. There the plate and the band have a question they did not have before —
 * WHICH work is playing — and these functions are the answer.
 *
 * `timeline.parts` is the store's own count of the media items on the rail, so
 * one part (or none) is a single work however many segments it has.
 */
export function isComposedContainer(data) {
  const parts = data?.timeline?.parts;
  return Array.isArray(parts) && parts.length > 1
    && Array.isArray(data?.segments) && data.segments.length > 0;
}

/**
 * The facts the piece register should be rotating while segment `index` of a
 * container's rail is sounding.
 *
 * THE PRECEDENCE, MOST SPECIFIC FIRST:
 *   1. THE SEGMENT'S OWN `note` — one authored line about exactly this stretch
 *      of music. Nothing more specific exists, so nothing outranks it.
 *   2. ITS GROUP WORK'S FACTS (`groupFacts[group.work]`, published by
 *      `YamlSurroundStore#composeOne`) — the four facts the corpus authored
 *      about the Heroic polonaise, while the Heroic polonaise is playing.
 *   3. THE CONTAINER'S OWN FACTS — the eight about the set. Also the answer
 *      when nothing is sounding (`index < 0`: the applause between two works,
 *      the walk-on before the first), because in that state the set is the only
 *      true subject the band has.
 *
 * A rung is taken only when it has text: a whitespace `note` and an empty facts
 * list are absences, not empty answers, and fall through.
 *
 * UNGATED, DELIBERATELY. `isComposedContainer` is the caller's decision and is
 * not read here, so this stays a pure statement of the precedence and can be
 * tested as one. A caller that passes an index on a single work gets that
 * work's segment note — which is why both callers pass -1 unless the payload
 * is a container.
 *
 * @param {object|null} data the surround payload.
 * @param {number} index into `data.segments` (the composed rail), -1 for none.
 * @returns {string[]} the authored strings, uncurled — the render seam curls.
 */
export function factPool(data, index) {
  const list = Array.isArray(data?.segments) ? data.segments : [];
  const segment = Number.isInteger(index) && index >= 0 ? list[index] : null;

  if (isText(segment?.note)) return [segment.note.trim()];

  const work = segment?.group?.work;
  const group = work ? texts(data?.groupFacts?.[work]) : [];
  if (group.length) return group;

  return texts(data?.facts);
}

/**
 * Every pool `factPool` can ever return for this container, in rail order.
 *
 * THE FIT IS A CONSTANT OF THE PIECE (`fit.js`, `bandPools`), and this is what
 * keeps that true now that the piece register's pool changes at a part
 * boundary. Measuring only the sounding segment's pool would re-solve the
 * band's type every time the rail moved to the next work — the reserved-height
 * law broken by the mechanism that replaced the reserve, one register over.
 *
 * The container's own facts are always included: they are the fallback for
 * every segment that has neither a note nor a work with facts, and for the dead
 * time between two works.
 *
 * @returns {string[]} the union, de-duplicated, order-stable.
 */
export function factPools(data) {
  const list = Array.isArray(data?.segments) ? data.segments : [];
  const seen = new Set();
  const out = [];
  const add = (s) => { if (!seen.has(s)) { seen.add(s); out.push(s); } };
  list.forEach((_, i) => factPool(data, i).forEach(add));
  factPool(data, -1).forEach(add);
  return out;
}
