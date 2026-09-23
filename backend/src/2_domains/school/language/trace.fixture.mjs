/**
 * The seq-16 recording sitting from the owner's live test on 2026-09-23
 * (glossika-korean, day 8), rebuilt as the stamped events the rung now emits.
 * Every learner here is `learner-a`. Used by `trace.test.mjs` and the CLI test.
 *
 * What the day's log showed, and the gaps it could not fill, are the reason
 * each field exists: a cut at 3611ms and piece 0 at 1.2s; piece 1 at 1.3s,
 * redo, 1.7s, redo; three Tab restarts in 5s; piece 1 run to 16.5s with no
 * auto-stop; stitched 19s later.
 */
const BASE = { traceId: 'run-seq16', learnerId: 'learner-a', corpus: 'glossika-korean', day: 8 };
let n = 0;
const ev = (name, t, data, level = 'info') => {
  n += 1;
  return {
    msg: `school.language.${name}`,
    time: null,
    level,
    data: { ...BASE, traceSeq: n, t, ...data },
    context: { runId: 'run-seq16' },
  };
};
const cap = (detail, t, data) => ev(`capture.${detail}`, t, { detail, seq: 16, ...data });

export const SEQ16_EVENTS = [
  ev('program.day-loaded', 0, { detail: 'day-loaded', total: 15, done: 9 }),
  ev('rung.landed', 200, { detail: 'landed', rung: 'recording', reason: 'resume', pending: 6, of: 15 }),
  cap('playback', 4702, { what: 'sentence', ms: 3702, outcome: 'stopped', via: 'key:ArrowRight', phase: 'prompting' }),
  cap('cut', 4702, {
    piece: 0, rawMs: 3702, cutMs: 3611, snapped: true, sentenceMs: 5400,
    pieceSpans: [{ from: 0, to: 3611 }, { from: 3611, to: 5400 }], via: 'key:ArrowRight', phase: 'prompting',
  }),
  cap('start', 5300, { piece: 0, via: 'auto', phase: 'prompting' }),
  cap('piece-stop', 6500, {
    piece: 0, durationMs: 1200, heard: true, fromMs: 0, toMs: 3611, spanMs: 3611,
    voicedMs: 900, silentMs: 200, endSilentMs: 100, via: 'key:Space', phase: 'recording',
  }),
  cap('playback', 7700, { piece: 0, what: 'take', ms: 1200, outcome: 'ended', via: 'auto', phase: 'playback' }),
  cap('review-idle', 9200, { piece: 0, ms: 1500, reviewMs: 1500, via: 'key:Space', phase: 'review' }),
  cap('piece-next', 9200, { piece: 1, via: 'key:Space', phase: 'review' }),
  cap('playback', 11600, { piece: 1, what: 'span', ms: 2400, outcome: 'ended', via: 'auto', phase: 'prompting' }),
  cap('start', 11600, { piece: 1, via: 'auto', phase: 'prompting' }),
  cap('piece-stop', 12900, {
    piece: 1, durationMs: 1300, heard: true, fromMs: 3611, toMs: 5400, spanMs: 1789,
    voicedMs: 1000, silentMs: 200, endSilentMs: 100, via: 'key:Space', phase: 'recording',
  }),
  cap('playback', 14200, { piece: 1, what: 'take', ms: 1300, outcome: 'ended', via: 'auto', phase: 'playback' }),
  cap('review-idle', 15000, { piece: 1, ms: 800, reviewMs: 800, via: 'key:Backspace', phase: 'review' }),
  cap('piece-redo', 15000, { piece: 1, via: 'key:Backspace', phase: 'review' }),
  cap('playback', 17400, { piece: 1, what: 'span', ms: 2400, outcome: 'ended', via: 'auto', phase: 'prompting' }),
  cap('start', 17400, { piece: 1, via: 'auto', phase: 'prompting' }),
  cap('piece-stop', 19100, {
    piece: 1, durationMs: 1700, heard: true, fromMs: 3611, toMs: 5400, spanMs: 1789,
    voicedMs: 1300, silentMs: 300, endSilentMs: 200, via: 'key:Space', phase: 'recording',
  }),
  cap('playback', 20800, { piece: 1, what: 'take', ms: 1700, outcome: 'ended', via: 'auto', phase: 'playback' }),
  cap('review-idle', 21500, { piece: 1, ms: 700, reviewMs: 700, via: 'key:Backspace', phase: 'review' }),
  cap('piece-redo', 21500, { piece: 1, via: 'key:Backspace', phase: 'review' }),
  cap('playback', 23900, { piece: 1, what: 'span', ms: 2400, outcome: 'ended', via: 'auto', phase: 'prompting' }),
  cap('start', 23900, { piece: 1, via: 'auto', phase: 'prompting' }),
  cap('replay-restart', 24100, { piece: 1, from: 'recording', via: 'key:Tab', phase: 'recording' }),
  cap('playback', 25300, { piece: 1, what: 'span', ms: 1200, outcome: 'stopped', via: 'key:Tab', phase: 'prompting' }),
  cap('replay-restart', 25300, { piece: 1, from: 'prompting', via: 'key:Tab', phase: 'prompting' }),
  cap('playback', 27700, { piece: 1, what: 'span', ms: 2400, outcome: 'ended', via: 'auto', phase: 'prompting' }),
  cap('start', 27700, { piece: 1, via: 'auto', phase: 'prompting' }),
  cap('replay-restart', 28900, { piece: 1, from: 'recording', via: 'key:Tab', phase: 'recording' }),
  cap('playback', 31300, { piece: 1, what: 'span', ms: 2400, outcome: 'ended', via: 'auto', phase: 'prompting' }),
  cap('start', 31300, { piece: 1, via: 'auto', phase: 'prompting' }),
  cap('silent-warning', 33300, { piece: 1, afterMs: 2000, via: 'auto', phase: 'recording' }),
  cap('silent-cleared', 34400, { piece: 1, afterMs: 3100, via: 'auto', phase: 'recording' }),
  cap('piece-stop', 47800, {
    piece: 1, durationMs: 16500, heard: true, fromMs: 3611, toMs: 5400, spanMs: 1789,
    voicedMs: 2100, silentMs: 14100, endSilentMs: 11300, via: 'key:Space', phase: 'recording',
  }),
  cap('playback', 64300, { piece: 1, what: 'take', ms: 16500, outcome: 'ended', via: 'auto', phase: 'playback' }),
  cap('review-idle', 66800, { piece: 1, ms: 2500, reviewMs: 2500, via: 'key:Space', phase: 'review' }),
  cap('stitched', 66800, {
    pieces: 2, durationMs: 17700, voicedMs: 3000, silentMs: 14300, endSilentMs: 11300, via: 'key:Space', phase: 'review',
  }),
  cap('stop', 66800, {
    durationMs: 17700, heard: true, voicedMs: 3000, silentMs: 14300, endSilentMs: 11300, via: 'key:Space', phase: 'review',
  }),
  cap('playback', 84500, { what: 'take', ms: 17700, outcome: 'ended', via: 'auto', phase: 'playback' }),
  cap('review-idle', 86000, { ms: 1500, reviewMs: 1500, via: 'key:Space', phase: 'review' }),
  cap('keep', 86000, { joined: true, via: 'key:Space', phase: 'review' }),
];

export default SEQ16_EVENTS;
