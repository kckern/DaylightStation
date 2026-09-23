/**
 * `formatTrace` — turns a word-ladder sitting's log events into a human
 * timeline (spec §8 `school word-ladder trace`). Pure: no store access, no
 * clock, no I/O. `cli/school/wordLadder.mjs` owns fetching from the log
 * store (or reading a day file) and hands this module plain data.
 *
 * `events` is an array of already-normalized rows: `{ msg, time, level, data }`
 * — `msg` the dotted `school.word-ladder.<name>` event name, `data` the
 * payload as a plain (nested, typed) object. The log store flattens nested
 * fields to dotted `data.*`/`data.to.state` keys and stringifies every
 * value; un-flattening and type coercion is the CLI's job (see
 * `unflattenRow` there), not this module's — that keeps this file testable
 * against clean fixtures and free of any store-specific parsing.
 *
 * Two independent inputs, per the interface (spec §8 Task 3):
 *  - `events` — the frontend trace (stamped with `traceId`/`seq`/`t`, see
 *    `createTrace.js`) plus backend events for the same sitting (`opened`,
 *    `graded`, `transition`, `closed`, …), which carry no `seq`/`traceId` at
 *    all (they are ordinary service-side log calls, not routed through a
 *    trace). Ordering is by `seq` WITHIN a trace — never by `_time`, which
 *    the store mislabels (local time stamped as if it were UTC). Backend
 *    events are merged onto the matching item by `sittingId` + `itemId`,
 *    never independently timeline-ordered.
 *  - `{ dayFile }` — when given, `events` is ignored and the day file's own
 *    `items` map is rendered instead (the fallback path for when the log
 *    store has aged out or is unreachable). A day file has absolute
 *    timestamps (`at`) but none of a trace's per-item `ms`/stall detail, so
 *    the output says so up front.
 */

const MSG = {
  ITEM_SHOWN: 'school.word-ladder.item.shown',
  ITEM_ANSWERED: 'school.word-ladder.item.answered',
  ITEM_STALLED: 'school.word-ladder.item.stalled',
  ITEM_LAYOUT: 'school.word-ladder.item.layout',
  SITTING_CLOSED: 'school.word-ladder.sitting.closed',
  BACKEND_TRANSITION: 'school.word-ladder.transition',
  BACKEND_GRADED: 'school.word-ladder.graded',
  BACKEND_CLOSED: 'school.word-ladder.closed',
};

// A gap on one item at or above this is worth flagging even when no explicit
// `item.stalled` fired — that event only fires at the 45s/120s thresholds
// (spec §8), so a 30-44s gap would otherwise never surface.
const STALL_GAP_MS = 30_000;
const CLEAN_ENDINGS = new Set(['goal', 'cap']);

/** `123456ms -> "2:03"`. Unknown/negative input renders as `?:??` rather than throwing. */
function mmss(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '?:??';
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function seconds(ms) {
  return Math.round((typeof ms === 'number' ? ms : 0) / 1000);
}

/** A response object rendered compactly for one item line. */
function formatResponse(response) {
  if (response == null || typeof response !== 'object') return '—';
  if (typeof response.typed === 'string') return response.typed;
  if (typeof response.sort === 'string') return `sort:${response.sort}`;
  if ('choice' in response) return `choice:${response.choice}`;
  if (response.undo === true) return 'undo';
  if (response.menu === true) return 'menu';
  if (response.quizNow === true) return 'quiz-now';
  const keys = Object.keys(response);
  if (!keys.length) return '—';
  return keys.map((k) => `${k}:${JSON.stringify(response[k])}`).join(',');
}

/** The `<correct/score>` slot: correct/incorrect wins when known, else a raw score, else unknown. */
function formatOutcome(answered) {
  if (!answered) return '—';
  if (typeof answered.correct === 'boolean') return answered.correct ? '✓' : '✗';
  if (typeof answered.score === 'number') return `score ${answered.score}`;
  return '—';
}

function formatMs(answered) {
  return answered && typeof answered.ms === 'number' ? `${answered.ms}ms` : '—';
}

// `item.mode` NOT `data.mode`: the trace-level `mode` field (live|test) is
// stamped by createTrace.event() onto every event, so an item.shown call's
// own flashcard intro-vs-sort distinction is logged as `data.itemMode`
// instead, to avoid colliding with it. `itemMode` is absent on item types
// that don't have one (copy, typed, …), and on events logged before that
// field existed — fall back to the bare type rather than show nothing.
function kindOf(item) {
  return item.itemMode ? `${item.type ?? '?'}:${item.itemMode}` : (item.type ?? '?');
}

function transitionsSuffix(transitions) {
  if (!transitions?.length) return '';
  return transitions.map((t) => ` → ${t?.to?.state ?? '?'}`).join('');
}

function itemLine(item, { isLeftHere }) {
  const taskOrLayout = item.task ?? item.layout ?? '—';
  // Only from item.layout, so most lines carry no fontPx at all rather than
  // a placeholder — that event is a once-per-item follow-up, not universal.
  const fontPx = typeof item.fontPx === 'number' ? ` ${item.fontPx}px` : '';
  const response = formatResponse(item.answered?.response);
  const outcome = formatOutcome(item.answered);
  const ms = formatMs(item.answered);
  const left = isLeftHere ? ' ✗ left here' : '';
  return `${mmss(item.tStart)}  ${kindOf(item)} ${item.wordId ?? '—'} ${taskOrLayout}${fontPx} ${response} ${outcome} (${ms})${transitionsSuffix(item.transitions)}${left}`;
}

/**
 * `⚠ stalled <duration>` lines for one item: every explicit `item.stalled`
 * event, plus (only when none fired) a synthetic line when the shown→answered
 * gap — `item.answered.ms`, which IS that gap by construction (spec §8
 * `item.answered` logs `ms` since the item was shown) — is itself ≥ 30s.
 * An item with an explicit stall is never also flagged for the same gap.
 */
function stallLines(item) {
  if (item.stalls.length) return item.stalls.map((s) => `    ⚠ stalled ${seconds(s.ms)}s`);
  if (item.answered && typeof item.answered.ms === 'number' && item.answered.ms >= STALL_GAP_MS) {
    return [`    ⚠ stalled ${seconds(item.answered.ms)}s`];
  }
  return [];
}

function buildTrace(traceId, feEvents, backendEvents) {
  const ordered = [...feEvents].sort((a, b) => (a.data?.seq ?? 0) - (b.data?.seq ?? 0));
  let learnerId = null;
  let deckId = null;
  let pkg = null;
  let mode = null;
  let sittingId = null;
  let day = null;
  let closeEvent = null; // { reason, activeMs, itemId }
  let orphaned = 0; // answered/stalled/transition/graded events with no matching item.shown — the log window is missing rows, not that nothing happened
  const items = [];
  const byItemId = new Map();

  for (const ev of ordered) {
    const d = ev.data ?? {};
    learnerId ??= d.learnerId ?? null;
    deckId ??= d.deckId ?? null;
    pkg ??= d.package ?? null;
    mode ??= d.mode ?? null;
    // Runs on every event (not "once") because the sitting isn't known until
    // it opens — early events (mounted, started) have no sittingId yet. Once
    // it does appear it's constant for the rest of the trace, so the last
    // non-empty value written here is also the only one that ever differs.
    if (typeof d.sittingId === 'string' && d.sittingId) sittingId = d.sittingId;
    if (typeof d.day === 'string') day = d.day;

    if (ev.msg === MSG.ITEM_SHOWN) {
      const item = {
        itemId: d.itemId ?? null, type: d.type ?? null, itemMode: d.itemMode ?? null,
        task: d.task ?? null, layout: d.layout ?? null, wordId: d.wordId ?? null,
        tStart: typeof d.t === 'number' ? d.t : null, answered: null, stalls: [], transitions: [],
      };
      items.push(item);
      if (item.itemId) byItemId.set(item.itemId, item);
    } else if (ev.msg === MSG.ITEM_ANSWERED) {
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      if (!item) { orphaned += 1; }
      else {
        item.answered = {
          response: d.response ?? null, correct: typeof d.correct === 'boolean' ? d.correct : null,
          score: typeof d.score === 'number' ? d.score : null, judge: d.judge ?? null,
          ms: typeof d.ms === 'number' ? d.ms : null,
        };
      }
    } else if (ev.msg === MSG.ITEM_STALLED) {
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      if (!item) orphaned += 1;
      else if (typeof d.ms === 'number') item.stalls.push({ ms: d.ms });
    } else if (ev.msg === MSG.ITEM_LAYOUT) {
      // The main FitText's first computed size for this item, once (a
      // follow-up to item.shown, whose own fontPx is always null).
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      if (!item) orphaned += 1;
      else if (typeof d.fontPx === 'number') item.fontPx = d.fontPx;
    } else if (ev.msg === MSG.SITTING_CLOSED) {
      closeEvent = {
        reason: d.reason ?? null, activeMs: typeof d.activeMs === 'number' ? d.activeMs : null,
        itemId: d.itemId ?? null,
      };
    }
  }

  // Backend events for this sitting: no seq/traceId of their own, so they are
  // never part of the ordered stream above — only merged onto the item (or
  // sitting) they name, by sittingId + itemId (never by time).
  const backendForSitting = backendEvents.filter((ev) => ev.data?.sittingId === sittingId);
  for (const ev of backendForSitting) {
    const d = ev.data ?? {};
    if (!day && typeof d.day === 'string') day = d.day;
    if (ev.msg === MSG.BACKEND_TRANSITION && d.itemId) {
      const item = byItemId.get(d.itemId);
      if (!item) orphaned += 1;
      else item.transitions.push({ wordId: d.wordId ?? null, from: d.from ?? null, to: d.to ?? null, source: d.source ?? null });
    } else if (ev.msg === MSG.BACKEND_GRADED && d.itemId) {
      const item = byItemId.get(d.itemId);
      if (!item) { orphaned += 1; }
      else if (item.answered) {
        item.answered.correct = item.answered.correct ?? (typeof d.correct === 'boolean' ? d.correct : null);
        item.answered.score = item.answered.score ?? (typeof d.score === 'number' ? d.score : null);
        item.answered.judge = item.answered.judge ?? d.judge ?? null;
      }
    } else if (ev.msg === MSG.BACKEND_CLOSED) {
      // Authoritative for reason/activeMs (the service is the source of
      // truth for why a sitting ended); the ITEM it ended on is only ever
      // known from the frontend's own `sitting.closed`.
      closeEvent = {
        reason: d.reason ?? null, activeMs: typeof d.activeMs === 'number' ? d.activeMs : null,
        itemId: closeEvent?.itemId ?? null,
      };
    }
  }

  const ending = closeEvent?.reason ?? null;
  const duration = closeEvent?.activeMs ?? (items.length ? items[items.length - 1].tStart : null);
  const endedOnItemId = closeEvent?.itemId ?? (items.length ? items[items.length - 1].itemId : null);
  // No close event at all (a crash, a killed tab) is exactly as unearned an
  // ending as an explicit leave/idle/unmount — there is no reason to treat
  // silence as if it were a clean goal/cap finish.
  const markLeftHere = !CLEAN_ENDINGS.has(ending);

  const header = `${learnerId ?? '?'} · ${pkg ?? '?'} · ${day ?? '?'} · ${mode ?? '?'} · trace ${traceId} · ${mmss(duration)} · ${ending ?? 'unknown'}`;
  const lines = [header];
  for (const item of items) {
    lines.push(itemLine(item, { isLeftHere: markLeftHere && item.itemId === endedOnItemId }));
    lines.push(...stallLines(item));
  }
  if (orphaned > 0) lines.push(`⚠ ${orphaned} orphaned event(s) — log rows missing`);
  return lines.join('\n');
}

/** Backend-only events sharing a sittingId but no frontend trace at all — a degraded block: header, no item detail. */
function buildBackendOnlyBlock(sittingId, events) {
  let learnerId = null;
  let pkg = null;
  let mode = null;
  let day = null;
  let closeEvent = null;
  const rows = [];
  for (const ev of events) {
    const d = ev.data ?? {};
    learnerId ??= d.learnerId ?? null;
    pkg ??= d.package ?? null;
    mode ??= d.mode ?? null;
    if (typeof d.day === 'string') day = d.day;
    if (ev.msg === MSG.BACKEND_CLOSED) closeEvent = d;
    if (ev.msg === MSG.BACKEND_GRADED) rows.push(`    graded ${d.wordId ?? '?'} ${d.task ?? '?'} ${d.correct ? '✓' : '✗'}`);
    else if (ev.msg === MSG.BACKEND_TRANSITION) rows.push(`    transition ${d.wordId ?? '?'} → ${d.to?.state ?? '?'}`);
  }
  const ending = closeEvent?.reason ?? null;
  const duration = typeof closeEvent?.activeMs === 'number' ? closeEvent.activeMs : null;
  const header = `${learnerId ?? '?'} · ${pkg ?? '?'} · ${day ?? '?'} · ${mode ?? '?'} · sitting ${sittingId} · ${mmss(duration)} · ${ending ?? 'unknown'}`;
  return [header, '(backend events only — no item-level detail)', ...rows].join('\n');
}

function formatTraceFromEvents(events) {
  const fe = events.filter((e) => e?.data && typeof e.data.seq === 'number' && typeof e.data.traceId === 'string' && e.data.traceId);
  const be = events.filter((e) => !fe.includes(e));
  if (fe.length) {
    const traceIds = [...new Set(fe.map((e) => e.data.traceId))];
    traceIds.sort((a, b) => {
      const ta = Math.min(...fe.filter((e) => e.data.traceId === a).map((e) => e.data.t ?? 0));
      const tb = Math.min(...fe.filter((e) => e.data.traceId === b).map((e) => e.data.t ?? 0));
      return ta - tb;
    });
    return traceIds.map((id) => buildTrace(id, fe.filter((e) => e.data.traceId === id), be)).join('\n\n');
  }
  // No frontend trace at all — group the fallback (sittingId) way.
  const withSitting = be.filter((e) => typeof e.data?.sittingId === 'string' && e.data.sittingId);
  if (!withSitting.length) return '';
  const sittingIds = [...new Set(withSitting.map((e) => e.data.sittingId))];
  return sittingIds.map((sid) => buildBackendOnlyBlock(sid, withSitting.filter((e) => e.data.sittingId === sid))).join('\n\n');
}

function formatDayFileFallback(dayFile) {
  const lines = ['(from day file — no timing detail)'];
  const items = dayFile?.items && typeof dayFile.items === 'object' ? dayFile.items : {};
  const rows = Object.entries(items).sort(([, a], [, b]) => String(a?.at ?? '').localeCompare(String(b?.at ?? '')));
  for (const [itemId, rec] of rows) {
    const at = typeof rec?.at === 'string' ? rec.at : '?';
    const wordId = rec?.wordId ?? '—';
    const task = rec?.task ?? '—';
    const response = formatResponse(rec?.response);
    const outcome = typeof rec?.result?.correct === 'boolean' ? (rec.result.correct ? '✓' : '✗') : '—';
    lines.push(`${at}  ${itemId} ${wordId} ${task} ${response} ${outcome}`);
  }
  return lines.join('\n');
}

/**
 * `formatTrace(events, { dayFile? }) -> string`
 *
 * With `dayFile`, `events` is ignored and the day file's `items` are printed
 * instead (fallback path, spec §8). Otherwise renders one block per trace
 * found in `events` (normally one — a reopened sitting mounts a fresh trace
 * each time, so more than one block for the same `sittingId` is a reopen,
 * not a bug), blocks separated by a blank line. An empty `events` with no
 * `dayFile` renders as an empty string — the CLI decides what "nothing
 * found" should say to the person running it.
 */
export function formatTrace(events = [], { dayFile } = {}) {
  if (dayFile) return formatDayFileFallback(dayFile);
  return formatTraceFromEvents(Array.isArray(events) ? events : []);
}

export default formatTrace;
