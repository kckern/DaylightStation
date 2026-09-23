/**
 * `formatTrace` — turns a card-ladder sitting's log events into a human
 * timeline (spec §8 `school card-ladder trace`). Pure: no store access, no
 * clock, no I/O. `cli/school/cardLadder.mjs` owns fetching from the log
 * store (or reading a day file) and hands this module plain data.
 *
 * `events` is an array of already-normalized rows: `{ msg, time, level, data }`
 * — `msg` the dotted `school.card-ladder.<name>` event name, `data` the
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
  ITEM_SHOWN: 'school.card-ladder.item.shown',
  ITEM_ANSWERED: 'school.card-ladder.item.answered',
  ITEM_STALLED: 'school.card-ladder.item.stalled',
  ITEM_LAYOUT: 'school.card-ladder.item.layout',
  SITTING_CLOSED: 'school.card-ladder.sitting.closed',
  BACKEND_TRANSITION: 'school.card-ladder.transition',
  BACKEND_GRADED: 'school.card-ladder.graded',
  BACKEND_CLOSED: 'school.card-ladder.closed',
  BACKEND_SERVED: 'school.card-ladder.item.served',
  BACKEND_ABANDONED: 'school.card-ladder.sitting.abandoned',
};
const P = 'school.card-ladder.';

// A gap on one item at or above this is worth flagging even when no explicit
// `item.stalled` fired — that event only fires at the 45s/120s thresholds
// (spec §8), so a 30-44s gap would otherwise never surface.
const STALL_GAP_MS = 30_000;
const CLEAN_ENDINGS = new Set(['goal', 'cap']);
const SUB = '    ';
// How far up the ladder a state sits, for the footer's climbed / slipped.
const RANK = { new: 0, introduced: 1, notYet: 1, familiar: 2, claimed: 3, mastered: 4 };

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

const secs1 = (ms) => `${(Math.round((typeof ms === 'number' ? ms : 0) / 100) / 10).toFixed(1)}s`;

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

/**
 * The step an item belongs to, from its id (engine ids: `r<n>:i:` Learn,
 * `r<n>:s:` Sort, `r<n>:q:` / `r<n>:offer` Quiz, `r<n>:m` Match, `rc:` Review,
 * `d<n>:` Drill, `p<n>:` Practice, summary/menu Done). Works on logs from
 * before `step.entered` existed. Null for an id it does not know.
 */
export function stepOfItem(itemId) {
  if (typeof itemId !== 'string') return null;
  let m = /^r(\d+):(i|s|q|m|offer)/.exec(itemId);
  if (m) {
    const name = { i: 'Learn', s: 'Sort', q: 'Quiz', offer: 'Quiz', m: 'Match' }[m[2]];
    return { name, label: `${name} · round ${m[1]}` };
  }
  if (itemId.startsWith('rc:')) return { name: 'Review', label: 'Review' };
  m = /^(d\d+):/.exec(itemId);
  if (m) return { name: 'Drill', label: `Drill ${m[1]}` };
  m = /^(p\d+):/.exec(itemId);
  if (m) return { name: 'Practice', label: `Practice ${m[1]}` };
  if (itemId === 'summary' || itemId === 'menu') return { name: 'Done', label: 'Done' };
  return null;
}

function itemLine(item, { isLeftHere }) {
  const taskOrLayout = item.task ?? item.layout ?? '—';
  // Only from item.layout, so most lines carry no fontPx at all rather than
  // a placeholder — that event is a once-per-item follow-up, not universal.
  const fontPx = typeof item.fontPx === 'number' ? ` ${item.fontPx}px` : '';
  const response = formatResponse(item.answered?.response);
  const outcome = formatOutcome(item.answered);
  const ms = formatMs(item.answered);
  const why = item.served?.reason ? ` · why ${item.served.reason}` : '';
  const via = `${item.answered?.input ? ` · via ${item.answered.input}` : ''}${item.answered?.micOff ? ' (no mic)' : ''}`;
  const left = isLeftHere ? ' ✗ left here' : '';
  return `${mmss(item.tStart)}  ${kindOf(item)} ${item.wordId ?? '—'} ${taskOrLayout}${fontPx} ${response} ${outcome} (${ms})${transitionsSuffix(item.transitions)}${why}${via}${left}`;
}

function stallLine(d) {
  const notes = [];
  if (d.visibility === 'hidden') notes.push('tab hidden');
  if (d.screen === 'result') notes.push('on the verdict');
  return `${SUB}⚠ stalled ${seconds(d.ms)}s${notes.length ? ` (${notes.join(', ')})` : ''}`;
}

/** One frontend sub-event rendered under its item, or null when it has no line. */
function frontendSubLine(msg, d) {
  switch (msg) {
    case `${P}audio.played`: {
      const clip = d.clip ?? d.kind ?? '?';
      const how = [d.trigger ?? null, d.trigger !== 'auto' ? d.input ?? null : null].filter(Boolean).join(' ');
      const line = `♪ ${clip}${how ? ` ${how}` : ''} → ${d.outcome ?? '?'}`;
      return d.outcome && d.outcome !== 'ended' ? `${SUB}⚠ ${line}` : `${SUB}${line}`;
    }
    case `${P}card.flipped`: return `${SUB}⟲ flipped after ${secs1(d.ms)}`;
    case `${P}card.undone`: return `${SUB}↶ undo`;
    case `${P}say.recording`: {
      const extra = [];
      if (typeof d.durationMs === 'number') extra.push(`${secs1(d.durationMs)} long`);
      if (d.status != null) extra.push(`status ${d.status}`);
      if (d.reason) extra.push(d.reason);
      const line = `● take ${d.phase ?? '?'} at ${secs1(d.ms)}${extra.length ? ` (${extra.join(', ')})` : ''}`;
      return d.phase === 'failed' || d.phase === 'unavailable' ? `${SUB}⚠ ${line}` : `${SUB}${line}`;
    }
    // Pre-sweep names, so older sittings still read.
    case `${P}recording.uploaded`: return `${SUB}● take uploaded${typeof d.durationMs === 'number' ? ` (${secs1(d.durationMs)} long)` : ''}`;
    case `${P}recording.failed`: return `${SUB}⚠ ● take failed${d.status != null ? ` (status ${d.status})` : ''}`;
    case `${P}recording.refused`: return `${SUB}● take refused${d.reason ? ` (${d.reason})` : ''}`;
    case `${P}mic.unavailable`: return `${SUB}⚠ ● take unavailable (no mic)`;
    case `${P}item.skipped`: return `${SUB}↷ skipped via ${d.via ?? '?'} after ${secs1(d.ms)}${d.micOff ? ' (no mic)' : ''}`;
    case `${P}showme.used`: return `${SUB}? show me via ${d.via ?? '?'} after ${secs1(d.ms)}`;
    case `${P}result.shown`: {
      const mark = d.correct === true ? '✓' : d.correct === false ? '✗' : '—';
      return `${SUB}▣ verdict ${mark} shown${d.held ? ' (held)' : ' (retry)'}`;
    }
    case `${P}result.dismissed`: return `${SUB}▣ next via ${d.via ?? '?'} after ${secs1(d.ms)}`;
    case `${P}keypad.toggled`: return `${SUB}⌨ keypad ${d.open ? 'open' : 'closed'}${d.auto ? ' (auto)' : d.via ? ` (${d.via})` : ''}`;
    case `${P}visibility`: return d.state === 'hidden' ? `${SUB}◐ tab hidden` : `${SUB}◑ tab ${d.state ?? '?'}`;
    case `${P}notice.shown`: return `${SUB}! notice ${d.reason ?? ''}`.trimEnd();
    case `${P}write.failed`: return `${SUB}⚠ answer not saved (status ${d.status ?? '?'})`;
    case `${P}session.reopened`: return `${SUB}⚠ sitting reopened (from ${d.from ?? '?'})`;
    case `${P}media.failed`: return `${SUB}⚠ ${d.kind ?? 'media'} failed to load`;
    default: return null;
  }
}

/** One backend plan event rendered under the answer that caused it, or null. */
function planLine(msg, d) {
  switch (msg) {
    case `${P}round.planned`: {
      const parts = [];
      if (d.newIds?.length) parts.push(`new ${d.newIds.join(',')}`);
      if (d.carryIds?.length) parts.push(`carry ${d.carryIds.join(',')}`);
      return `${SUB}⇢ round ${d.round ?? '?'} planned (${d.kind ?? '?'}): ${parts.join(' · ') || 'no words'}`;
    }
    case `${P}round.phase`: {
      let detail = '';
      if (d.to === 'quiz' && Array.isArray(d.queue)) detail = ` [${d.queue.join(' ')}]`;
      else if (d.to === 'match' && Array.isArray(d.wordIds)) detail = ` [${d.wordIds.join(' ')}]`;
      else if (d.to === 'offer' && d.wordId) detail = ` [${d.wordId}]`;
      return `${SUB}⇢ round ${d.round ?? '?'}: ${d.from ?? '?'} → ${d.to ?? '?'}${detail}`;
    }
    case `${P}drill.started`: return `${SUB}⇢ drill ${d.drillId ?? '?'} started: ${d.wordId ?? '?'} (${d.source ?? '?'}) ${(d.steps ?? []).join(',')}`;
    case `${P}drill.finished`: return `${SUB}⇢ drill ${d.drillId ?? '?'} finished${d.excluded ? ' (word excluded)' : ''}`;
    case `${P}day.done`: return `${SUB}⇢ day done`;
    case `${P}word.prereqs`: {
      const has = [`recognized ${d.recognizedCount ?? 0}`, d.matched ? 'matched' : null, d.typedSignedOff ? 'signed off' : null].filter(Boolean).join(' · ');
      const needs = d.gaps?.length ? ` (needs ${d.gaps.join(',')})` : ' (ready for sign-off)';
      return `${SUB}⇢ ${d.wordId ?? '?'} ${has}${d.typedSignedOff ? '' : needs}`;
    }
    default: return null;
  }
}

/**
 * A short evaluation of one sitting: counts, time per step (each item runs
 * until the next one appears, the last until the trace's final event),
 * wrong answers, and each word's net move.
 */
function summaryLines(items, fe, transitions, endT) {
  const real = items.filter((it) => it.type !== 'summary' && it.type !== 'menu');
  const answered = items.filter((it) => it.answered);
  const wrong = answered.filter((it) => it.answered.correct === false);
  const count = (name) => fe.filter((ev) => ev.msg === `${P}${name}`).length;
  const stalls = fe.filter((ev) => ev.msg === MSG.ITEM_STALLED);
  const audio = fe.filter((ev) => ev.msg === `${P}audio.played`);
  const audioFailed = audio.filter((ev) => ev.data?.outcome && ev.data.outcome !== 'ended').length;
  const takes = fe.filter((ev) => (ev.msg === `${P}say.recording` && ev.data?.phase === 'uploaded') || ev.msg === `${P}recording.uploaded`).length;
  const hidden = stalls.filter((ev) => ev.data?.visibility === 'hidden').length;
  const lines = ['── summary ──'];
  lines.push([
    `items ${real.length}`, `answered ${answered.length}`, `wrong ${wrong.length}`, `skipped ${count('item.skipped')}`,
    `show-me ${count('showme.used')}`, `stalls ${stalls.length}${hidden ? ` (${hidden} hidden)` : ''}`,
    `audio ${audio.length}${audioFailed ? ` (${audioFailed} failed)` : ''}`, `takes ${takes}`,
  ].join(' · '));
  const perStep = new Map();
  items.forEach((it, i) => {
    const step = stepOfItem(it.itemId)?.name;
    if (!step || typeof it.tStart !== 'number') return;
    const until = i + 1 < items.length ? items[i + 1].tStart : endT;
    if (typeof until !== 'number') return;
    perStep.set(step, (perStep.get(step) ?? 0) + Math.max(0, until - it.tStart));
  });
  if (perStep.size) lines.push(`time: ${[...perStep].map(([step, ms]) => `${step} ${mmss(ms)}`).join(' · ')}`);
  if (wrong.length) {
    lines.push(`wrong: ${wrong.map((it) => `${it.wordId ?? '?'} ${it.task ?? it.type ?? '?'} ${formatResponse(it.answered.response)}`).join(' · ')}`);
  }
  const moves = new Map();
  for (const t of transitions) {
    if (!t.wordId) continue;
    const row = moves.get(t.wordId) ?? { from: t.from ?? null, to: null };
    row.to = t.to ?? null;
    moves.set(t.wordId, row);
  }
  const climbed = [];
  const slipped = [];
  for (const [wordId, { from, to }] of moves) {
    const a = RANK[from?.state] ?? 0;
    const b = RANK[to?.state] ?? 0;
    const stageUp = from?.state === 'mastered' && to?.state === 'mastered' && (to?.stage ?? 0) > (from?.stage ?? 0);
    const label = `${wordId} ${from?.state ?? '?'}→${to?.state ?? '?'}${stageUp ? ` (stage ${from.stage ?? 0}→${to.stage})` : ''}`;
    if (b > a || stageUp) climbed.push(label);
    else if (b < a || (from?.state === 'mastered' && to?.state === 'mastered' && (to?.stage ?? 0) < (from?.stage ?? 0))) slipped.push(label);
  }
  if (climbed.length) lines.push(`climbed: ${climbed.join(' · ')}`);
  if (slipped.length) lines.push(`slipped: ${slipped.join(' · ')}`);
  return lines;
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
  // FitText measures in a layout effect, so an item's item.layout lands one
  // seq BEFORE its item.shown. Hold it until the item appears.
  const earlyLayout = new Map();
  const preamble = []; // sub-lines before any item (open-time plan)
  let current = null; // the item on screen, for sub-events that name none
  let endT = null;
  const subOf = (d) => (d.itemId ? byItemId.get(d.itemId) ?? current : current);

  for (const ev of ordered) {
    const d = ev.data ?? {};
    learnerId ??= d.learnerId ?? null;
    deckId ??= d.deckId ?? null;
    pkg ??= d.package ?? null;
    mode ??= d.mode ?? null;
    if (typeof d.t === 'number') endT = Math.max(endT ?? d.t, d.t);
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
        tStart: typeof d.t === 'number' ? d.t : null, answered: null, stalls: 0, transitions: [], subs: [], plan: [], served: null,
      };
      items.push(item);
      current = item;
      if (item.itemId) {
        byItemId.set(item.itemId, item);
        if (earlyLayout.has(item.itemId)) { item.fontPx = earlyLayout.get(item.itemId); earlyLayout.delete(item.itemId); }
      }
    } else if (ev.msg === MSG.ITEM_ANSWERED) {
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      if (!item) { orphaned += 1; }
      else {
        item.answered = {
          response: d.response ?? null, correct: typeof d.correct === 'boolean' ? d.correct : null,
          score: typeof d.score === 'number' ? d.score : null, judge: d.judge ?? null,
          ms: typeof d.ms === 'number' ? d.ms : null, input: d.input ?? null,
          // A say step moved past with no mic: an answer, not a skip.
          micOff: d.micOff === true,
        };
      }
    } else if (ev.msg === MSG.ITEM_STALLED) {
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      if (!item) orphaned += 1;
      else if (typeof d.ms === 'number') { item.stalls += 1; item.subs.push(stallLine(d)); }
    } else if (ev.msg === MSG.ITEM_LAYOUT) {
      // The main FitText's first computed size for this item, once (a
      // follow-up to item.shown, whose own fontPx is always null).
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      const px = typeof d.fontPx === 'number' ? d.fontPx : null;
      if (item) { if (px !== null) item.fontPx = px; }
      else if (d.itemId) earlyLayout.set(d.itemId, px);
      else orphaned += 1;
    } else if (ev.msg === MSG.SITTING_CLOSED) {
      closeEvent = {
        reason: d.reason ?? null, activeMs: typeof d.activeMs === 'number' ? d.activeMs : null,
        itemId: d.itemId ?? null,
      };
    } else {
      const line = frontendSubLine(ev.msg, d);
      if (line) (subOf(d)?.subs ?? preamble).push(line);
    }
  }

  // Backend events for this sitting: no seq/traceId of their own, so they are
  // never part of the ordered stream above — only merged onto the item (or
  // sitting) they name, by sittingId + itemId (never by time).
  // In the service's own order: the store returns rows newest-first, and a
  // word's net move (the footer) needs its transitions oldest-first. `_time`
  // is mislabeled but one clock, so it orders backend rows among themselves.
  const backendForSitting = backendEvents
    .filter((ev) => ev.data?.sittingId === sittingId)
    .map((ev, i) => ({ ev, i, ms: Date.parse(ev.time ?? '') }))
    .sort((a, b) => (Number.isFinite(a.ms) && Number.isFinite(b.ms) && a.ms !== b.ms ? a.ms - b.ms : a.i - b.i))
    .map(({ ev }) => ev);
  const transitions = [];
  const tail = [];
  for (const ev of backendForSitting) {
    const d = ev.data ?? {};
    if (!day && typeof d.day === 'string') day = d.day;
    if (ev.msg === MSG.BACKEND_TRANSITION && d.itemId) {
      const item = byItemId.get(d.itemId);
      if (!item) orphaned += 1;
      else {
        const row = { wordId: d.wordId ?? null, from: d.from ?? null, to: d.to ?? null, source: d.source ?? null };
        item.transitions.push(row);
        transitions.push(row);
      }
    } else if (ev.msg === MSG.BACKEND_GRADED && d.itemId) {
      const item = byItemId.get(d.itemId);
      if (!item) { orphaned += 1; }
      else if (item.answered) {
        item.answered.correct = item.answered.correct ?? (typeof d.correct === 'boolean' ? d.correct : null);
        item.answered.score = item.answered.score ?? (typeof d.score === 'number' ? d.score : null);
        item.answered.judge = item.answered.judge ?? d.judge ?? null;
      }
    } else if (ev.msg === MSG.BACKEND_SERVED && d.itemId) {
      // Why it came up — the first serve wins (a later `get` only re-serves it).
      const item = byItemId.get(d.itemId);
      if (item && (!item.served || item.served.via === 'get')) item.served = d;
    } else if (ev.msg === MSG.BACKEND_ABANDONED) {
      tail.push(`⚠ abandoned — idle ${mmss(d.idleMs)}, last answer ${d.lastItemId ?? '—'}, on screen ${d.onScreenItemId ?? '—'} (seen at the next request)`);
    } else if (ev.msg === MSG.BACKEND_CLOSED) {
      // Authoritative for reason/activeMs (the service is the source of
      // truth for why a sitting ended); the ITEM it ended on is only ever
      // known from the frontend's own `sitting.closed`.
      closeEvent = {
        reason: d.reason ?? null, activeMs: typeof d.activeMs === 'number' ? d.activeMs : null,
        itemId: closeEvent?.itemId ?? null,
      };
    } else {
      const line = planLine(ev.msg, d);
      if (!line) continue;
      const item = d.itemId ? byItemId.get(d.itemId) : null;
      (item ? item.plan : preamble).push(line);
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
  const lines = [header, ...preamble];
  let section = null;
  for (const item of items) {
    const step = stepOfItem(item.itemId);
    if (step && step.label !== section) { lines.push(`── ${step.label} ──`); section = step.label; }
    lines.push(itemLine(item, { isLeftHere: markLeftHere && item.itemId === endedOnItemId }));
    lines.push(...item.subs);
    // No explicit stall fired, but the shown→answered gap (`item.answered.ms`,
    // by construction) is itself ≥ 30s: flag it from the gap alone.
    if (!item.stalls && item.answered && typeof item.answered.ms === 'number' && item.answered.ms >= STALL_GAP_MS) {
      lines.push(`${SUB}⚠ stalled ${seconds(item.answered.ms)}s`);
    }
    lines.push(...item.plan);
  }
  lines.push(...tail);
  orphaned += earlyLayout.size; // a layout whose item.shown never arrived
  if (orphaned > 0) lines.push(`⚠ ${orphaned} orphaned event(s) — log rows missing`);
  if (items.length) lines.push(...summaryLines(items, ordered, transitions, endT));
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
