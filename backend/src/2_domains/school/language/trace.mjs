/**
 * `formatSentenceTrace` — a sentence-ladder sitting's log events as a human
 * timeline (`school sentence-ladder trace`). Pure: no store access, no clock,
 * no I/O. `cli/school/sentenceLadder.mjs` fetches and un-flattens the rows and
 * hands this plain `{ msg, time, level, data, context }` objects.
 *
 * A sitting is one run of the program — one `traceId` (the run id; see the
 * frontend's `languageLog.js`). Within it, events are ordered by `traceSeq`,
 * never by the store's `_time` (local time mislabelled as UTC), and grouped by
 * SENTENCE (`data.seq`) and rung, one block each time the learner moves on.
 *
 * The recording rung's vocabulary is the point: pieces and their spans, takes
 * with how much of them was voice, playbacks with how they ended, time sat on a
 * review, and every step's `via` (the key or touch that drove it) and `phase`
 * (where the rung was when it did). A reader should be able to say, for any
 * gap, whether it was sound playing, a learner sitting, or a stall.
 *
 * Every learner name in the tests is `learner-a`; nothing here names a person
 * or a language.
 */

const PREFIX = 'school.language.';

function secs(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?s';
  return `${(ms / 1000).toFixed(1)}s`;
}

/** `86000 -> "1:26.0"`. */
function clock(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '?:??.?';
  const tenths = Math.round(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** An array field arrives from the log store as a JSON string. */
function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.startsWith('[')) {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function name(event) {
  return String(event.msg || '').slice(PREFIX.length);
}

function tag(d) {
  if (!d.via && !d.phase) return '';
  return `  [${[d.via, d.phase].filter(Boolean).join(' · ')}]`;
}

const pieceOf = (d) => (d.piece != null ? ` piece ${d.piece}` : '');

function voice(d) {
  if (d.voicedMs == null) return ' · voice not measured';
  return ` · voiced ${secs(d.voicedMs)} silent ${secs(d.silentMs)} end-silence ${secs(d.endSilentMs)}`;
}

/** One event's line text, or null for an event the timeline does not show. */
function describe(event, summary = null) {
  const d = event.data || {};
  switch (name(event)) {
    case 'capture.cut': {
      const spans = list(d.pieceSpans).map((s) => `${s.from}–${s.to ?? 'end'}`).join(' | ');
      const raw = d.rawMs != null && d.rawMs !== d.cutMs ? ` (raw ${d.rawMs}${d.snapped ? ', snapped' : ''})` : '';
      const of = d.sentenceMs != null ? ` of ${d.sentenceMs}ms` : '';
      return `cut piece ${d.piece} at ${d.cutMs}ms${raw} → pieces ${spans || '?'}${of}`;
    }
    case 'capture.start': return `mic open${pieceOf(d)}`;
    case 'capture.piece-stop': {
      const span = d.spanMs != null ? ` of span ${secs(d.spanMs)}` : '';
      return `take${pieceOf(d)} ${secs(d.durationMs)}${span}${voice(d)}${d.heard === false ? ' · NOT HEARD' : ''}`;
    }
    case 'capture.stop':
      return `${summary?.joinedStop ? 'joined take' : 'take'} ${secs(d.durationMs)}${voice(d)}${d.heard === false ? ' · NOT HEARD' : ''}`;
    case 'capture.refused': return `REFUSED${pieceOf(d)} ${d.reason} (${secs(d.durationMs)})`;
    case 'capture.playback': return `▶ ${d.what}${pieceOf(d)}${d.language ? ` ${d.language}` : ''} ${secs(d.ms)} ${d.outcome}`;
    case 'capture.review-idle': return `idle on review ${secs(d.ms)}${d.reviewMs != null && d.reviewMs !== d.ms ? ` (review ${secs(d.reviewMs)})` : ''}`;
    case 'capture.piece-next': return `next → piece ${d.piece}`;
    case 'capture.piece-redo': return `redo piece ${d.piece}`;
    case 'capture.piece-resume': return `resume piece ${d.piece}`;
    case 'capture.retake': return `record again${d.joined ? ' (whole sentence)' : ''}`;
    case 'capture.replay-restart': return `restart${pieceOf(d)} from ${d.from}`;
    case 'capture.restart': return `start over${d.pieces != null ? ` (${d.pieces} pieces dropped)` : ''}`;
    case 'capture.compare': return `compare${pieceOf(d)}`;
    case 'capture.hear': return `hear${pieceOf(d)}${d.what ? ` ${d.what}` : ''}`;
    case 'capture.auto-stop': return `auto-stop${pieceOf(d)} after ${secs(d.silentMs)} of silence`;
    case 'capture.stitched': return `stitched ${d.pieces} pieces → ${secs(d.durationMs)}${voice(d)}${d.partial ? ' · PARTIAL' : ''}`;
    case 'capture.stitch-failed': return `JOIN FAILED (${d.error})`;
    case 'capture.keep': return `kept${d.joined ? ' (joined)' : ''}`;
    case 'capture.silent-warning': return `silent warning after ${secs(d.afterMs)}${d.piece != null ? ` (piece ${d.piece})` : ''}`;
    case 'capture.silent-cleared': return `silent cleared after ${secs(d.afterMs)}${d.piece != null ? ` (piece ${d.piece})` : ''}`;
    case 'capture.pieces-abandoned': return `abandoned ${d.pieces} pieces`;
    case 'capture.denied': return 'MIC DENIED';
    case 'rung.stalled': return `STALLED ${Math.round((d.ms || 0) / 1000)}s at ${d.phase ?? '?'} (screen ${d.screen ?? '?'})`;
    case 'interpretation.checked': {
      const verdict = d.verdict != null ? ` · ${d.verdict}` : '';
      const sim = typeof d.similarity === 'number' ? ` · ${Math.round(d.similarity * 100)}%` : '';
      return `checked (${d.inputMode})${verdict}${sim}`;
    }
    case 'interpretation.gave-up': return 'gave up — answer shown';
    default: return null;
  }
}

/** Sentence-level events: the ones that belong under a `seq · rung` heading. */
function rungOf(event) {
  const n = name(event);
  if (n.startsWith('capture.')) return 'recording';
  if (n.startsWith('interpretation.')) return 'interpretation';
  return event.data?.rung ?? null;
}

function blankSummary() {
  return {
    pieces: 0, takes: 0, refused: 0, redos: 0, restarts: 0, restartVia: {}, playbackMs: 0, idleMs: 0,
    stalls: 0, ending: null, checked: 0, gaveUp: 0, autoStops: 0, joinedStop: false,
  };
}

function summaryLine(s) {
  const parts = [];
  if (s.pieces) parts.push(`pieces ${s.pieces}`);
  if (s.takes || s.refused) parts.push(`takes ${s.takes} (refused ${s.refused})`);
  if (s.redos) parts.push(`redos ${s.redos}`);
  const via = Object.entries(s.restartVia).map(([k, v]) => `${k}×${v}`).join(', ');
  if (s.restarts) parts.push(`restarts ${s.restarts}${via ? ` (${via})` : ''}`);
  if (s.autoStops) parts.push(`auto-stops ${s.autoStops}`);
  if (s.playbackMs) parts.push(`playback ${secs(s.playbackMs)}`);
  if (s.idleMs) parts.push(`review idle ${secs(s.idleMs)}`);
  if (s.checked) parts.push(`checked ${s.checked}`);
  if (s.gaveUp) parts.push(`gave up ${s.gaveUp}`);
  parts.push(`stalls ${s.stalls}`);
  parts.push(s.ending ?? 'not finished');
  return `  summary: ${parts.join(' · ')}`;
}

function tally(s, event) {
  const d = event.data || {};
  switch (name(event)) {
    case 'capture.cut': s.pieces = Math.max(s.pieces, list(d.pieceSpans).length); break;
    case 'capture.piece-stop': s.takes += 1; break;
    case 'capture.stitched': s.joinedStop = true; break;
    case 'capture.stop':
      // The joined take arrives as a `stop` straight after `stitched`; it is
      // the pieces again, not another take said.
      if (s.joinedStop) s.joinedStop = false; else s.takes += 1;
      break;
    case 'capture.refused': s.refused += 1; break;
    case 'capture.piece-redo': case 'capture.retake': s.redos += 1; break;
    case 'capture.replay-restart': case 'capture.restart':
      s.restarts += 1;
      s.restartVia[d.via ?? '?'] = (s.restartVia[d.via ?? '?'] || 0) + 1;
      break;
    case 'capture.auto-stop': s.autoStops += 1; break;
    case 'capture.playback': s.playbackMs += typeof d.ms === 'number' ? d.ms : 0; break;
    case 'capture.review-idle': s.idleMs += typeof d.ms === 'number' ? d.ms : 0; break;
    case 'capture.keep': s.ending = d.joined ? 'kept (joined)' : 'kept'; break;
    case 'rung.complete': if (!s.ending) s.ending = 'complete'; break;
    case 'rung.stalled': s.stalls += 1; break;
    case 'interpretation.checked': s.checked += 1; break;
    case 'interpretation.gave-up': s.gaveUp += 1; break;
    default: break;
  }
}

function order(a, b) {
  const sa = a.data?.traceSeq;
  const sb = b.data?.traceSeq;
  if (typeof sa === 'number' && typeof sb === 'number') return sa - sb;
  return String(a.time ?? '').localeCompare(String(b.time ?? ''));
}

function formatOne(traceId, events) {
  const sorted = [...events].sort(order);
  const first = sorted.find((e) => e.data?.learnerId) ?? sorted[0];
  const d0 = first.data || {};
  const lastT = sorted.reduce((m, e) => (typeof e.data?.t === 'number' ? Math.max(m, e.data.t) : m), 0);
  const day = sorted.map((e) => e.data?.day).find((v) => v != null);
  const lines = [
    `# ${d0.learnerId ?? '?'} · ${d0.corpus ?? '?'} · day ${day ?? '?'} · trace ${traceId} · ${sorted.length} events · ${clock(lastT)}`,
  ];

  let block = null; // { key, summary }
  const close = () => { if (block) lines.push(summaryLine(block.summary)); block = null; };

  for (const event of sorted) {
    const d = event.data || {};
    const n = name(event);
    if (n === 'rung.landed') {
      close();
      lines.push(`${clock(d.t)}  on ${d.rung} (${d.reason}, ${d.pending ?? '?'} of ${d.of ?? '?'} to do)`);
      continue;
    }
    const rung = rungOf(event);
    let text;
    if (rung && d.seq != null) {
      const key = `${d.seq}:${rung}`;
      if (!block || block.key !== key) {
        close();
        block = { key, summary: blankSummary() };
        lines.push(`seq ${d.seq} · ${rung}`);
      }
      text = describe(event, block.summary);
      tally(block.summary, event);
    } else {
      text = describe(event);
    }
    if (text) lines.push(`  ${clock(d.t)}  ${text}${tag(d)}`);
  }
  close();
  return lines.join('\n');
}

/**
 * `events` → the timeline text, one block per sitting (trace), or '' when
 * there are no sentence-ladder events at all.
 */
export function formatSentenceTrace(events = []) {
  const ours = (events || []).filter((e) => String(e?.msg || '').startsWith(PREFIX));
  if (!ours.length) return '';
  const traces = new Map();
  for (const e of ours) {
    const id = e.data?.traceId ?? e.context?.runId ?? 'untraced';
    if (!traces.has(id)) traces.set(id, []);
    traces.get(id).push(e);
  }
  return [...traces.entries()].map(([id, list_]) => formatOne(id, list_)).join('\n\n');
}

export default formatSentenceTrace;
