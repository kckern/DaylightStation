import { describe, expect, it } from 'vitest';
import { canonicalTraceMsg, formatTrace } from './trace.mjs';

// A minimal frontend event: everything a bound `createTrace` stamps onto
// every call (spec §8), plus whatever the caller wants in `data`.
function fe(msg, t, seq, data = {}) {
  return {
    msg: `school.card-ladder.${msg}`,
    time: new Date(2026, 8, 22, 10, 0, 0, t).toISOString(),
    level: 'info',
    data: {
      traceId: 'tr1', sittingId: t >= 200 ? 'korean-vocab.abc123.1' : null,
      seq, t, learnerId: 'learner-a', deckId: 'language/korean/week-01-classroom', package: 'korean-vocab', mode: 'live',
      ...data,
    },
  };
}

// A backend event: no seq/traceId at all — an ordinary service-side log call.
function be(msg, data = {}) {
  return {
    msg: `school.card-ladder.${msg}`, time: new Date(2026, 8, 22, 10, 2, 0, 0).toISOString(), level: 'info',
    data: { learnerId: 'learner-a', sittingId: 'korean-vocab.abc123.1', mode: 'live', package: 'korean-vocab', day: '2026-09-22', ...data },
  };
}

describe('formatTrace — intro, copy, sorts, verify miss, stall, leave', () => {
  const events = [
    fe('sitting.opened', 0, 1, { package: 'korean-vocab', first: 'flashcard', phase: 'round' }),
    // `itemMode` (not `mode`, which is the trace-level live/test field and would
    // otherwise collide — see kindOf() in trace.mjs) carries a flashcard's
    // intro-vs-sort distinction into the rendered "kind".
    fe('item.shown', 200, 2, { itemId: 'r1:0:intro', type: 'flashcard', itemMode: 'intro', task: null, wordId: 'gawi', layout: 'flashcard-front', media: false, fontPx: null }),
    // The main FitText's first computed size for this item, once, as a follow-up
    // to item.shown (whose own fontPx is always null — see cardLadderLog.js).
    fe('item.layout', 250, 3, { itemId: 'r1:0:intro', fontPx: 64 }),
    fe('item.answered', 3200, 4, { itemId: 'r1:0:intro', type: 'flashcard', task: null, response: {}, correct: null, score: null, judge: null, next: 'copy', ms: 3000 }),
    be('transition', { itemId: 'r1:0:intro', wordId: 'gawi', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'intro' }),

    fe('item.shown', 3400, 5, { itemId: 'r1:0:copy', type: 'copy', mode: null, task: null, wordId: 'gawi', layout: 'copy', media: false, fontPx: null }),
    fe('item.answered', 6400, 6, { itemId: 'r1:0:copy', type: 'copy', task: null, response: { typed: '가위' }, correct: true, score: null, judge: null, next: 'flashcard', ms: 3000 }),

    fe('item.shown', 6600, 7, { itemId: 'r1:s:1', type: 'flashcard', mode: null, task: null, wordId: 'gawi', layout: 'flashcard-front', media: false, fontPx: null }),
    fe('item.answered', 8600, 8, { itemId: 'r1:s:1', type: 'flashcard', task: null, response: { sort: 'claimed' }, correct: null, score: null, judge: null, next: 'flashcard', ms: 2000 }),
    be('transition', { itemId: 'r1:s:1', wordId: 'gawi', from: { state: 'introduced', stage: null }, to: { state: 'claimed', stage: null }, source: 'sort' }),

    fe('item.shown', 8800, 9, { itemId: 'r1:q:0', type: 'typed', mode: null, task: '3.3', wordId: 'gawi', layout: 'typed', media: false, fontPx: null }),
    // 40s to answer, wrong — no explicit item.stalled (that only fires at 45s), but the
    // gap is still ≥30s, so this must be flagged from the gap alone.
    fe('item.answered', 48800, 10, { itemId: 'r1:q:0', type: 'typed', task: '3.3', response: { typed: '가방' }, correct: false, score: 2, judge: 'model', next: 'flashcard', ms: 40000 }),
    be('graded', { itemId: 'r1:q:0', wordId: 'gawi', task: '3.3', source: 'verify', correct: false, score: 2, judge: 'model' }),

    fe('item.shown', 49000, 11, { itemId: 'r1:rc:0', type: 'typed', mode: null, task: '3.3', wordId: 'pul', layout: 'typed', media: false, fontPx: null }),
    fe('item.stalled', 94000, 12, { itemId: 'r1:rc:0', ms: 45000 }),
    fe('sitting.closed', 120000, 13, { sittingId: 'korean-vocab.abc123.1', itemId: 'r1:rc:0', reason: 'leave', activeMs: 118000, remaining: 600000 }),
    fe('unmounted', 120100, 14, { userId: 'learner-a', deckId: 'language/korean/week-01-classroom', test: false, sittingId: 'korean-vocab.abc123.1' }),
    be('closed', { reason: 'leave', activeMs: 118000, doneAt: null }),
  ];

  it('renders the exact timeline', () => {
    expect(formatTrace(events)).toBe([
      'learner-a · korean-vocab · 2026-09-22 · live · trace tr1 · 1:58 · leave',
      '0:00  flashcard:intro gawi flashcard-front 64px — — (3000ms) → introduced',
      '0:03  copy gawi copy 가위 ✓ (3000ms)',
      // Section headers come from the item id (r<n>:s: Sort, r<n>:q: Quiz);
      // these older-style intro/copy/recheck ids name no step, so no header.
      '── Sort · round 1 ──',
      '0:07  flashcard gawi flashcard-front sort:claimed — (2000ms) → claimed',
      '── Quiz · round 1 ──',
      '0:09  typed gawi 3.3 가방 ✗ (40000ms)',
      '    ⚠ stalled 40s',
      '0:49  typed pul 3.3 — — (—) ✗ left here',
      '    ⚠ stalled 45s',
      '── summary ──',
      'items 5 · answered 4 · wrong 1 · skipped 0 · show-me 0 · stalls 1 · audio 0 · takes 0',
      'time: Sort 0:02 · Quiz 0:40',
      'wrong: gawi 3.3 가방',
      'climbed: gawi new→claimed',
    ].join('\n'));
  });
});

describe('formatTrace — endings and grouping', () => {
  it('does not mark "left here" when the sitting ended on goal or cap', () => {
    const events = [
      fe('item.shown', 0, 1, { itemId: 'i1', type: 'summary', task: null, wordId: null, layout: 'summary' }),
      fe('sitting.closed', 5000, 2, { sittingId: 'korean-vocab.abc123.1', itemId: 'i1', reason: 'goal', activeMs: 5000 }),
    ];
    const out = formatTrace(events);
    expect(out).toContain('· 0:05 · goal');
    expect(out).not.toContain('left here');
  });

  it('renders one block per trace, in earliest-t order, when the store returns more than one mount', () => {
    // Deliberately out of order AND with distinct t values, so the assertion
    // actually exercises the sort rather than just preserving input order.
    const later = fe('item.shown', 5000, 1, { itemId: 'j1', type: 'summary', task: null, wordId: null, layout: 'summary' });
    later.data = { ...later.data, traceId: 'tr-later' };
    const earlier = fe('item.shown', 0, 1, { itemId: 'i1', type: 'summary', task: null, wordId: null, layout: 'summary' });
    earlier.data = { ...earlier.data, traceId: 'tr-earlier' };
    const out = formatTrace([later, earlier]);
    const blocks = out.split('\n\n');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('trace tr-earlier');
    expect(blocks[1]).toContain('trace tr-later');
  });

  it('falls back to grouping by sittingId (degraded, no item detail) when there is no frontend trace at all', () => {
    const out = formatTrace([
      be('graded', { itemId: 'p1:0', wordId: 'gawi', task: '3.3', source: 'verify', correct: true, score: 10, judge: 'exact' }),
      be('transition', { itemId: 'p1:0', wordId: 'gawi', from: { state: 'claimed', stage: null }, to: { state: 'mastered', stage: 0 }, source: 'verify' }),
      be('closed', { reason: 'cap', activeMs: 60000 }),
    ]);
    expect(out).toContain('sitting korean-vocab.abc123.1');
    expect(out).toContain('(backend events only — no item-level detail)');
    expect(out).toContain('graded gawi 3.3 ✓');
    expect(out).toContain('transition gawi → mastered');
  });

  it('returns an empty string for no events and no dayFile', () => {
    expect(formatTrace([])).toBe('');
    expect(formatTrace()).toBe('');
  });

  it('marks "left here" on the last item even with no close event at all (a crash or killed tab)', () => {
    const events = [
      fe('item.shown', 0, 1, { itemId: 'i1', type: 'typed', task: '3.3', wordId: 'gawi', layout: 'typed' }),
      fe('item.answered', 2000, 2, { itemId: 'i1', type: 'typed', task: '3.3', response: { typed: '가위' }, correct: true, ms: 2000 }),
      // No sitting.closed at all — the tab died mid-item. There is no reason
      // to trust that as a clean "goal"/"cap" ending, so it must still be flagged.
    ];
    const out = formatTrace(events);
    expect(out).toContain('unknown');
    expect(out).toContain('✗ left here');
  });

  it('reports orphaned answered/stalled/transition/graded events (no matching item.shown) instead of dropping them silently', () => {
    const events = [
      fe('item.shown', 0, 1, { itemId: 'i1', type: 'typed', task: '3.3', wordId: 'gawi', layout: 'typed' }),
      fe('item.answered', 1000, 2, { itemId: 'i1', type: 'typed', task: '3.3', response: { typed: '가위' }, correct: true, ms: 1000 }),
      // Every itemId below names an item this window's log rows never captured a `item.shown` for.
      fe('item.answered', 2000, 3, { itemId: 'ghost-answered', type: 'typed', task: '3.3', response: { typed: 'x' }, correct: false, ms: 500 }),
      fe('item.stalled', 3000, 4, { itemId: 'ghost-stalled', ms: 45000 }),
      fe('item.layout', 3500, 5, { itemId: 'ghost-layout', fontPx: 40 }),
      be('transition', { itemId: 'ghost-transition', wordId: 'gawi', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'intro' }),
      be('graded', { itemId: 'ghost-graded', wordId: 'gawi', task: '3.3', source: 'verify', correct: true }),
      fe('sitting.closed', 4000, 6, { sittingId: 'korean-vocab.abc123.1', itemId: 'i1', reason: 'goal', activeMs: 4000 }),
    ];
    const out = formatTrace(events);
    expect(out).toContain('⚠ 5 orphaned event(s) — log rows missing');
    // The real item is still rendered fine, undisturbed by the orphans.
    expect(out).toContain('0:00  typed gawi 3.3 가위 ✓ (1000ms)');
  });
});

describe('formatTrace — day file fallback', () => {
  it('prints items in order with the no-timing-detail header, ignoring events', () => {
    const dayFile = {
      items: {
        'r1:0:copy': { at: '2026-09-22T10:00:03-07:00', wordId: 'gawi', task: null, response: { typed: '가위' }, result: { correct: true } },
        'r1:0:intro': { at: '2026-09-22T10:00:00-07:00', wordId: 'gawi', task: null, response: {}, result: { ok: true } },
      },
    };
    expect(formatTrace([{ msg: 'irrelevant' }], { dayFile })).toBe([
      '(from day file — no timing detail)',
      '2026-09-22T10:00:00-07:00  r1:0:intro gawi — — —',
      '2026-09-22T10:00:03-07:00  r1:0:copy gawi — 가위 ✓',
    ].join('\n'));
  });

  it('renders just the disclaimer when the day file has no items', () => {
    expect(formatTrace([], { dayFile: { items: {} } })).toBe('(from day file — no timing detail)');
  });
});

describe('formatTrace — item.layout before item.shown (real FitText order)', () => {
  it('attaches the early size to its item and does not count it orphaned', () => {
    const out = formatTrace([
      fe('sitting.opened', 0, 1, { package: 'korean-vocab' }),
      fe('item.layout', 300, 2, { itemId: 'r1:0:intro', fontPx: 120 }),
      fe('item.shown', 301, 3, { itemId: 'r1:0:intro', type: 'flashcard', itemMode: 'intro', wordId: 'gawi', layout: 'flashcard-front', fontPx: null }),
      fe('item.layout', 900, 4, { itemId: 'never-shown', fontPx: 40 }),
    ]);
    expect(out).toContain('120px');
    expect(out).toContain('⚠ 1 orphaned event(s)');
  });
});

describe('formatTrace — sections, reasons, input, sub-lines and the summary footer (observability sweep)', () => {
  const events = [
    be('round.planned', { itemId: null, round: 'r1', index: 1, kind: 'new', size: 2, newIds: ['gawi', 'pul'], carryIds: [], hasMatch: true }),
    be('item.served', { itemId: 'r1:i:gawi:flash', type: 'flashcard', wordId: 'gawi', reason: 'intro', step: 'flash', via: 'open' }),
    fe('sitting.opened', 0, 1, { package: 'korean-vocab', first: 'flashcard', phase: 'round' }),
    fe('step.entered', 190, 2, { step: 'learn', round: 1 }),
    fe('item.shown', 200, 3, { itemId: 'r1:i:gawi:flash', type: 'flashcard', itemMode: 'intro', wordId: 'gawi', layout: 'flashcard-front' }),
    fe('audio.played', 1200, 4, { clip: 'term', trigger: 'auto', outcome: 'ended' }),
    fe('card.flipped', 3200, 5, { itemId: 'r1:i:gawi:flash', ms: 3000 }),
    fe('item.answered', 4200, 6, { itemId: 'r1:i:gawi:flash', type: 'flashcard', response: { seen: true }, ms: 4000, input: 'key:Space' }),
    be('transition', { itemId: 'r1:i:gawi:flash', wordId: 'gawi', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'intro' }),

    be('item.served', { itemId: 'r1:i:gawi:say', type: 'say', wordId: 'gawi', reason: 'intro', step: 'say', via: 'respond' }),
    fe('item.shown', 4300, 7, { itemId: 'r1:i:gawi:say', type: 'say', itemMode: 'say-after', wordId: 'gawi', layout: 'say' }),
    fe('audio.played', 4400, 8, { clip: 'term', trigger: 'auto', outcome: 'blocked' }),
    fe('item.skipped', 5800, 9, { itemId: 'r1:i:gawi:say', type: 'say', what: 'say', via: 'key:Backslash', ms: 1500, micOff: false }),
    fe('item.answered', 5800, 10, { itemId: 'r1:i:gawi:say', type: 'say', response: { done: true }, ms: 1500, input: 'key:Backslash' }),
    be('round.phase', { itemId: 'r1:i:gawi:say', round: 'r1', index: 1, from: 'intro', to: 'stream' }),

    be('item.served', { itemId: 'r1:s:0', type: 'flashcard', wordId: 'gawi', reason: 'stream', pass: 1, via: 'respond' }),
    fe('step.entered', 5900, 11, { step: 'sort', round: 1 }),
    fe('item.shown', 6000, 12, { itemId: 'r1:s:0', type: 'flashcard', itemMode: 'stream', wordId: 'gawi', layout: 'flashcard-front' }),
    fe('visibility', 20000, 13, { state: 'hidden' }),
    fe('item.stalled', 51000, 14, { itemId: 'r1:s:0', ms: 45000, visibility: 'hidden', screen: 'item' }),
    fe('visibility', 55000, 15, { state: 'visible' }),
    fe('item.answered', 56000, 16, { itemId: 'r1:s:0', type: 'flashcard', response: { sort: 'claimed' }, ms: 50000, input: 'touch' }),
    be('transition', { itemId: 'r1:s:0', wordId: 'gawi', from: { state: 'introduced', stage: null }, to: { state: 'claimed', stage: null }, source: 'sort' }),
    be('round.phase', { itemId: 'r1:s:0', round: 'r1', index: 1, from: 'stream', to: 'quiz', queue: ['gawi:3.1', 'gawi:2.2'] }),

    be('item.served', { itemId: 'r1:q:0', type: 'choice', task: '3.1', wordId: 'gawi', reason: 'verify-recognition', via: 'respond' }),
    fe('step.entered', 56100, 17, { step: 'quiz', round: 1 }),
    fe('item.shown', 56200, 18, { itemId: 'r1:q:0', type: 'choice', task: '3.1', wordId: 'gawi', layout: 'choice-text-cue' }),
    fe('item.answered', 59200, 19, { itemId: 'r1:q:0', type: 'choice', task: '3.1', response: { choice: '풀' }, correct: false, ms: 3000, input: 'key:1' }),
    fe('result.shown', 59210, 20, { itemId: 'r1:q:0', correct: false, held: true }),
    fe('result.dismissed', 61200, 21, { itemId: 'r1:q:0', via: 'key:Space', ms: 2000 }),
    be('graded', { itemId: 'r1:q:0', wordId: 'gawi', task: '3.1', source: 'verify', correct: false }),
    be('transition', { itemId: 'r1:q:0', wordId: 'gawi', from: { state: 'claimed', stage: null }, to: { state: 'familiar', stage: null }, source: 'verify' }),
    be('day.done', { itemId: 'r1:q:0', doneAt: '2026-09-22T10:01:01-07:00' }),

    be('item.served', { itemId: 'summary', type: 'summary', reason: 'summary', via: 'respond' }),
    fe('item.shown', 61300, 22, { itemId: 'summary', type: 'summary', layout: 'summary' }),
    fe('sitting.closed', 62000, 23, { sittingId: 'korean-vocab.abc123.1', itemId: 'summary', reason: 'goal', activeMs: 61000 }),
    be('closed', { reason: 'goal', activeMs: 61000 }),
  ];

  it('renders the exact timeline with its footer', () => {
    expect(formatTrace(events)).toBe([
      'learner-a · korean-vocab · 2026-09-22 · live · trace tr1 · 1:01 · goal',
      '    ⇢ round r1 planned (new): new gawi,pul',
      '── Learn · round 1 ──',
      '0:00  flashcard:intro gawi flashcard-front seen:true — (4000ms) → introduced · why intro · via key:Space',
      '    ♪ term auto → ended',
      '    ⟲ flipped after 3.0s',
      '0:04  say:say-after gawi say done:true — (1500ms) · why intro · via key:Backslash',
      '    ⚠ ♪ term auto → blocked',
      '    ↷ skipped via key:Backslash after 1.5s',
      '    ⇢ round r1: intro → stream',
      '── Sort · round 1 ──',
      '0:06  flashcard:stream gawi flashcard-front sort:claimed — (50000ms) → claimed · why stream · via touch',
      '    ◐ tab hidden',
      '    ⚠ stalled 45s (tab hidden)',
      '    ◑ tab visible',
      '    ⇢ round r1: stream → quiz [gawi:3.1 gawi:2.2]',
      '── Quiz · round 1 ──',
      '0:56  choice gawi 3.1 choice:풀 ✗ (3000ms) → familiar · why verify-recognition · via key:1',
      '    ▣ verdict ✗ shown (held)',
      '    ▣ next via key:Space after 2.0s',
      '    ⇢ day done',
      '── Done ──',
      '1:01  summary — summary — — (—) · why summary',
      '── summary ──',
      'items 4 · answered 4 · wrong 1 · skipped 1 · show-me 0 · stalls 1 (1 hidden) · audio 2 (1 failed) · takes 0',
      'time: Learn 0:06 · Sort 0:50 · Quiz 0:05 · Done 0:01',
      'wrong: gawi 3.1 choice:풀',
      'climbed: gawi new→familiar',
    ].join('\n'));
  });

  it('a sitting abandoned (idle-closed, never closed by its client) says where it stopped', () => {
    const out = formatTrace([
      fe('item.shown', 200, 1, { itemId: 'r1:q:2', type: 'typed', task: '3.3', wordId: 'gawi', layout: 'type' }),
      be('sitting.abandoned', { lastItemId: 'r1:q:2', onScreenItemId: 'r1:q:3', idleMs: 600000 }),
    ]);
    expect(out).toContain('⚠ abandoned — idle 10:00, last answer r1:q:2, on screen r1:q:3 (seen at the next request)');
  });

  it('say.recording, show-me, keypad and a stall on a held verdict render as sub-lines', () => {
    const out = formatTrace([
      fe('item.shown', 0, 1, { itemId: 'r1:i:gawi:say', type: 'say', itemMode: 'say-after', wordId: 'gawi', layout: 'say' }),
      fe('say.recording', 2000, 2, { itemId: 'r1:i:gawi:say', phase: 'started', ms: 2000 }),
      fe('say.recording', 5000, 3, { itemId: 'r1:i:gawi:say', phase: 'stopped', ms: 5000 }),
      fe('say.recording', 5400, 4, { itemId: 'r1:i:gawi:say', phase: 'uploaded', ms: 5400, durationMs: 3000, bytes: 50000 }),
      fe('item.shown', 6000, 5, { itemId: 'p1:0', type: 'typed', task: '3.3', wordId: 'gawi', layout: 'type' }),
      fe('keypad.toggled', 6100, 6, { auto: true, open: true }),
      fe('showme.used', 9000, 7, { itemId: 'p1:0', via: 'touch', ms: 3000 }),
      fe('item.stalled', 60000, 8, { itemId: 'p1:0', ms: 45000, visibility: 'visible', screen: 'result' }),
    ]);
    expect(out).toContain('    ● take started at 2.0s');
    expect(out).toContain('    ● take uploaded at 5.4s (3.0s long)');
    expect(out).toContain('── Practice p1 ──');
    expect(out).toContain('    ⌨ keypad open (auto)');
    expect(out).toContain('    ? show me via touch after 3.0s');
    expect(out).toContain('    ⚠ stalled 45s (on the verdict)');
    expect(out).toContain('takes 1');
  });

  it('a say step moved past with no mic is an answer marked (no mic), never a skip', () => {
    const out = formatTrace([
      fe('item.shown', 0, 1, { itemId: 'r1:i:gawi:say', type: 'say', itemMode: 'say-after', wordId: 'gawi', layout: 'say' }),
      fe('say.recording', 10, 2, { itemId: 'r1:i:gawi:say', phase: 'unavailable', ms: 10 }),
      fe('item.answered', 1500, 3, { itemId: 'r1:i:gawi:say', type: 'say', response: { done: true }, ms: 1500, input: 'key:Space', micOff: true }),
    ]);
    expect(out).toContain('say:say-after gawi say done:true — (1500ms) · via key:Space (no mic)');
    expect(out).toContain('skipped 0');
  });
});

describe('formatTrace — events logged under the pre-rename school.word-ladder.* names', () => {
  const events = [
    fe('sitting.opened', 0, 1, { package: 'korean-vocab', first: 'flashcard', phase: 'round' }),
    fe('item.shown', 200, 2, { itemId: 'r1:0:intro', type: 'flashcard', itemMode: 'intro', task: null, wordId: 'gawi', layout: 'flashcard-front', media: false, fontPx: null }),
    fe('item.answered', 3200, 3, { itemId: 'r1:0:intro', type: 'flashcard', task: null, response: {}, correct: null, score: null, judge: null, next: 'copy', ms: 3000 }),
    be('transition', { itemId: 'r1:0:intro', wordId: 'gawi', from: { state: 'new', stage: null }, to: { state: 'introduced', stage: null }, source: 'intro' }),
  ];
  const legacy = (event) => ({ ...event, msg: event.msg.replace('school.card-ladder.', 'school.word-ladder.') });

  it('renders the old names exactly as the new ones, and a mix of both', () => {
    const expected = formatTrace(events);
    expect(formatTrace(events.map(legacy))).toBe(expected);
    expect(formatTrace(events.map((event, i) => (i % 2 ? legacy(event) : event)))).toBe(expected);
  });
  it('canonicalTraceMsg rewrites only the old prefix', () => {
    expect(canonicalTraceMsg('school.word-ladder.item.shown')).toBe('school.card-ladder.item.shown');
    expect(canonicalTraceMsg('school.card-ladder.item.shown')).toBe('school.card-ladder.item.shown');
    expect(canonicalTraceMsg('school.sentence-ladder.item')).toBe('school.sentence-ladder.item');
    expect(canonicalTraceMsg(undefined)).toBeUndefined();
  });
});
