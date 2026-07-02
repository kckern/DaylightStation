// arrangementScheduler — pure event-builder for section/arrangement playback
// (Producer song mode), layered on loopScheduler. A SECTION is a stack with a
// forced length in bars: layers shorter than the section tile (same behavior
// as buildLoopCycle); layers longer are truncated at the boundary with
// synthesized note_offs so nothing sticks. An ARRANGEMENT compiles
// (section × repeats) into blocks the React transport walks, and
// nextJumpPoint answers where a live-queued section switch may land
// (scene-launch model: 'repeat' = end of current block, 'bar' = next bar).
// No DOM, no timers — pure functions, node-testable.

import { loopToEvents, layerLengthMs } from './loopScheduler.mjs';

/** Accept timeSig as [beats, beatType] (this module's API) or
 * { beats, beatType } (loopScheduler's shape). */
function normalizeTimeSig(timeSig) {
  if (Array.isArray(timeSig)) return { beats: timeSig[0] ?? 4, beatType: timeSig[1] ?? 4 };
  const { beats = 4, beatType = 4 } = timeSig || {};
  return { beats, beatType };
}

function barLengthMs(bpm, { beats, beatType }) {
  return (60000 / bpm) * (4 / beatType) * beats;
}

/**
 * Truncate a time-sorted event stream at `lengthMs`:
 * - note_ons at or beyond the boundary are dropped (the boundary instant
 *   belongs to the next pass of the loop, not this one);
 * - note_offs whose note_on was dropped are dropped too;
 * - note_offs beyond the boundary whose note_on was KEPT are moved to exactly
 *   the boundary — no stuck notes;
 * - note_offs at or before the boundary pass through untouched.
 * Pairing is by (note, channel) open-count, so overlapping repeats of the same
 * pitch resolve in order.
 */
function truncateEvents(events, lengthMs) {
  const out = [];
  const open = new Map(); // `${note}|${channel}` → count of kept, unclosed note_ons
  for (const e of events) {
    const key = `${e.note}|${e.channel}`;
    if (e.type === 'note_on') {
      if (e.t < lengthMs) {
        out.push(e);
        open.set(key, (open.get(key) || 0) + 1);
      }
    } else {
      const n = open.get(key) || 0;
      if (n > 0) {
        open.set(key, n - 1);
        out.push(e.t <= lengthMs ? e : { ...e, t: lengthMs });
      }
    }
  }
  return out;
}

/**
 * Build one cycle of a section: like buildLoopCycle, but the cycle length is
 * FORCED to `lengthBars` — shorter layers tile to fill it, longer layers are
 * truncated at the boundary (with synthesized note_offs; see truncateEvents).
 * A section whose layers are all muted/silent still reports its full lengthMs:
 * the section occupies its bars in the arrangement regardless of audibility.
 *
 * @param {{lengthBars:number, stack:Array}} section — stack layers use the
 *   loopScheduler layer shape ({notes, ppq, transpose?, muted?, velocity?,
 *   barSpan?, channel?, gain?}).
 * @param {{bpm:number, timeSig?:[number,number]|{beats:number,beatType:number}}} opts
 * @returns {{events:Array, lengthMs:number}} — degenerate ({events:[], lengthMs:0})
 *   when lengthBars <= 0 or the stack is empty/absent.
 */
export function buildSectionCycle(section, opts) {
  const { bpm, timeSig = [4, 4] } = opts;
  const ts = normalizeTimeSig(timeSig);
  const lengthBars = Number(section?.lengthBars);
  const stack = section?.stack;
  if (!Number.isFinite(lengthBars) || lengthBars <= 0 || !Array.isArray(stack) || !stack.length) {
    return { events: [], lengthMs: 0 };
  }
  const lengthMs = lengthBars * barLengthMs(bpm, ts);

  const events = [];
  for (const l of stack) {
    if (l.muted || !l.notes?.length) continue;
    const layerLenMs = layerLengthMs(l, bpm, ts);
    // Tile enough copies to cover the forced span (epsilon guards float error
    // on exact multiples), then truncate the whole layer stream at once so a
    // note ringing across a tile boundary still pairs with its own off.
    const repeats = Math.max(1, Math.ceil(lengthMs / layerLenMs - 1e-9));
    const layerEvents = [];
    for (let r = 0; r < repeats; r += 1) {
      layerEvents.push(...loopToEvents(l.notes, {
        ppq: l.ppq, bpm, transpose: l.transpose || 0, velocity: l.velocity ?? 90,
        cycleStartMs: r * layerLenMs, channel: l.channel ?? 0, gain: l.gain ?? 1,
      }));
    }
    layerEvents.sort((a, b) => a.t - b.t);
    events.push(...truncateEvents(layerEvents, lengthMs));
  }
  events.sort((a, b) => a.t - b.t);
  return { events, lengthMs };
}

/** Coerce an arrangement entry's repeat count: floor, minimum 1; anything
 * non-numeric (undefined, 'x', NaN) means "play it once". */
function coerceRepeats(repeats) {
  const n = Math.floor(Number(repeats));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Compile an arrangement into a flat timeline of blocks for the transport.
 * One block per (arrangement entry × repeat), laid end to end.
 *
 * Event times are LOCAL to each block (0-based): the transport offsets by
 * block.startMs when scheduling, which lets every repeat of a section share
 * the SAME events array — the section cycle is computed once per unique
 * sectionId. Consumers must therefore treat block.events as immutable.
 *
 * @param {Array<{id:string, lengthBars:number, stack:Array}>} sections
 * @param {Array<{sectionId:string, repeats?:number}>} arrangement
 * @param {{bpm:number, timeSig?:[number,number]|{beats:number,beatType:number}}} opts
 * @returns {{blocks:Array<{sectionId:string, repeatIdx:number, startMs:number, lengthMs:number, events:Array}>, totalMs:number}}
 * @throws {TypeError} when an arrangement entry references a sectionId that is
 *   not in `sections` — a dangling reference is a pipeline bug, not a
 *   playback condition to paper over.
 */
export function compileArrangement(sections, arrangement, opts) {
  const sectionList = Array.isArray(sections) ? sections : [];
  const entries = Array.isArray(arrangement) ? arrangement : [];
  if (!sectionList.length || !entries.length) return { blocks: [], totalMs: 0 };

  const byId = new Map(sectionList.map((s) => [s.id, s]));
  const cycleCache = new Map(); // sectionId → { events, lengthMs }, computed once
  const blocks = [];
  let cursor = 0;
  for (const entry of entries) {
    const sectionId = entry?.sectionId;
    const section = byId.get(sectionId);
    if (!section) {
      throw new TypeError(`compileArrangement: unknown sectionId "${String(sectionId)}"`);
    }
    let cycle = cycleCache.get(sectionId);
    if (!cycle) {
      cycle = buildSectionCycle(section, opts);
      cycleCache.set(sectionId, cycle);
    }
    const repeats = coerceRepeats(entry.repeats);
    for (let r = 0; r < repeats; r += 1) {
      blocks.push({
        sectionId, repeatIdx: r, startMs: cursor, lengthMs: cycle.lengthMs, events: cycle.events,
      });
      cursor += cycle.lengthMs;
    }
  }
  return { blocks, totalMs: cursor };
}

/**
 * Where a live-queued section switch may land, in arrangement time (ms).
 *
 * Boundary rules (both deliberate, both tested):
 * - A position exactly ON a block boundary belongs to the block STARTING
 *   there, so 'repeat' mode returns THAT block's end — queueing at the first
 *   instant of a repeat means "finish this repeat".
 * - 'bar' mode uses strict >: a position exactly on a bar line resolves to
 *   the NEXT bar, never instantly re-fires at the current instant.
 * - 'bar' never lands past the current block's end (a jump can't land midway
 *   into a different block's music), so the naive next bar is clamped to the
 *   block end.
 *
 * positionMs at/beyond the arrangement total (or empty blocks) wraps to 0 —
 * the queued jump lands at the top of the arrangement.
 *
 * @param {number} positionMs — current transport position in arrangement time
 * @param {Array<{startMs:number, lengthMs:number}>} blocks — from compileArrangement
 * @param {'repeat'|'bar'} mode
 * @param {number} barMs — bar length in ms (only used in 'bar' mode)
 * @returns {number}
 */
export function nextJumpPoint(positionMs, blocks, mode, barMs) {
  if (!Array.isArray(blocks) || !blocks.length) return 0;
  const block = blocks.find((b) => positionMs >= b.startMs && positionMs < b.startMs + b.lengthMs);
  if (!block) return 0; // beyond totalMs (or before 0) → wrap to start
  const blockEnd = block.startMs + block.lengthMs;
  if (mode === 'bar') {
    const nextBar = (Math.floor(positionMs / barMs) + 1) * barMs; // strict >
    return Math.min(nextBar, blockEnd);
  }
  return blockEnd; // 'repeat'
}

export default { buildSectionCycle, compileArrangement, nextJumpPoint };
