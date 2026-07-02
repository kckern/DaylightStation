import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSectionCycle, compileArrangement, nextJumpPoint } from './arrangementScheduler.mjs';

// 120bpm 4/4, ppq 480 → beat = 500ms, bar = 2000ms.
const BAR_MS = 2000;
const oneBarNotes = [{ ticks: 0, durationTicks: 480, midi: 60 }]; // rounds to 1 bar
const oneBarLayer = { notes: oneBarNotes, ppq: 480 };

describe('buildSectionCycle', () => {
  it('forces the cycle length to lengthBars regardless of layer lengths', () => {
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [oneBarLayer] }, { bpm: 120 });
    assert.equal(cycle.lengthMs, 2 * BAR_MS);
  });

  it('tiles a shorter layer to fill the section (1-bar layer in 2-bar section)', () => {
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [oneBarLayer] }, { bpm: 120 });
    const ons = cycle.events.filter((e) => e.type === 'note_on' && e.note === 60).map((e) => e.t);
    assert.deepEqual(ons, [0, 2000]); // mirrors buildLoopCycle tiling
  });

  it('truncates a longer layer: events beyond the boundary are dropped', () => {
    // 4-bar layer in a 2-bar section: note_on at 5000ms (bar 3) must vanish.
    const layer = {
      notes: [
        { ticks: 0, durationTicks: 480, midi: 60 },
        { ticks: 4800, durationTicks: 480, midi: 64 }, // on @5000ms, off @5500ms — beyond 4000
      ],
      ppq: 480,
      barSpan: 4,
    };
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [layer] }, { bpm: 120 });
    assert.equal(cycle.lengthMs, 4000);
    assert.ok(!cycle.events.some((e) => e.note === 64), 'events beyond the boundary must be dropped');
    assert.ok(cycle.events.every((e) => e.t <= 4000));
  });

  it('synthesizes a note_off AT the boundary for a note_on whose off falls beyond it', () => {
    // note_on @3800ms, natural off @4200ms → off must be emitted at exactly 4000ms.
    // 3800ms = 7.6 beats = 3648 ticks; 400ms duration = 384 ticks.
    const layer = {
      notes: [{ ticks: 3648, durationTicks: 384, midi: 62 }],
      ppq: 480,
      barSpan: 4,
      channel: 3,
    };
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [layer] }, { bpm: 120 });
    const on = cycle.events.find((e) => e.type === 'note_on' && e.note === 62);
    assert.ok(on, 'note_on before the boundary is kept');
    assert.equal(on.t, 3800);
    const off = cycle.events.find((e) => e.type === 'note_off' && e.note === 62);
    assert.ok(off, 'a note_off must be synthesized — no stuck notes');
    assert.equal(off.t, 4000);
    assert.equal(off.channel, 3);
  });

  it('keeps a note_off landing exactly ON the boundary (not dropped, not moved)', () => {
    // on @3000ms (2880 ticks), duration 1000ms (960 ticks) → off exactly @4000ms.
    const layer = { notes: [{ ticks: 2880, durationTicks: 960, midi: 65 }], ppq: 480, barSpan: 4 };
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [layer] }, { bpm: 120 });
    const off = cycle.events.find((e) => e.type === 'note_off' && e.note === 65);
    assert.equal(off.t, 4000);
  });

  it('drops a note_on landing exactly ON the boundary (boundary belongs to the next pass)', () => {
    const layer = { notes: [{ ticks: 3840, durationTicks: 480, midi: 67 }], ppq: 480, barSpan: 4 };
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [layer] }, { bpm: 120 });
    assert.ok(!cycle.events.some((e) => e.note === 67));
  });

  it('passes channel and gain through like buildLoopCycle', () => {
    const cycle = buildSectionCycle({
      lengthBars: 1,
      stack: [{ ...oneBarLayer, channel: 9, gain: 0.5 }],
    }, { bpm: 120 });
    const on = cycle.events.find((e) => e.type === 'note_on');
    assert.equal(on.channel, 9);
    assert.equal(on.velocity, 45);
  });

  it('skips muted layers but keeps the forced section length', () => {
    const cycle = buildSectionCycle({
      lengthBars: 2,
      stack: [{ ...oneBarLayer, muted: true }],
    }, { bpm: 120 });
    assert.deepEqual(cycle.events, []);
    assert.equal(cycle.lengthMs, 4000);
  });

  it('returns the degenerate cycle for lengthBars <= 0 or an empty stack', () => {
    assert.deepEqual(buildSectionCycle({ lengthBars: 0, stack: [oneBarLayer] }, { bpm: 120 }), { events: [], lengthMs: 0 });
    assert.deepEqual(buildSectionCycle({ lengthBars: -1, stack: [oneBarLayer] }, { bpm: 120 }), { events: [], lengthMs: 0 });
    assert.deepEqual(buildSectionCycle({ lengthBars: 2, stack: [] }, { bpm: 120 }), { events: [], lengthMs: 0 });
    assert.deepEqual(buildSectionCycle({ lengthBars: 2 }, { bpm: 120 }), { events: [], lengthMs: 0 });
  });

  it('respects a non-4/4 timeSig ([3,4]: bar = 1500ms at 120bpm)', () => {
    const cycle = buildSectionCycle({ lengthBars: 2, stack: [oneBarLayer] }, { bpm: 120, timeSig: [3, 4] });
    assert.equal(cycle.lengthMs, 3000);
  });
});

// Shared fixtures for arrangement tests.
const sectionA = { id: 'A', lengthBars: 2, stack: [oneBarLayer] };
const sectionB = { id: 'B', lengthBars: 1, stack: [{ notes: [{ ticks: 0, durationTicks: 480, midi: 72 }], ppq: 480 }] };

describe('compileArrangement', () => {
  it('expands section × repeats into blocks (2-bar section × 3 @120bpm)', () => {
    const { blocks, totalMs } = compileArrangement([sectionA], [{ sectionId: 'A', repeats: 3 }], { bpm: 120 });
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks.map((b) => b.startMs), [0, 4000, 8000]);
    assert.deepEqual(blocks.map((b) => b.lengthMs), [4000, 4000, 4000]);
    assert.deepEqual(blocks.map((b) => b.repeatIdx), [0, 1, 2]);
    assert.deepEqual(blocks.map((b) => b.sectionId), ['A', 'A', 'A']);
    assert.equal(totalMs, 12000);
  });

  it('shares one events array reference across repeats of the same section', () => {
    const { blocks } = compileArrangement([sectionA], [{ sectionId: 'A', repeats: 3 }], { bpm: 120 });
    assert.equal(blocks[0].events, blocks[1].events);
    assert.equal(blocks[1].events, blocks[2].events);
  });

  it('shares the cycle across separate arrangement entries of the same section', () => {
    const { blocks } = compileArrangement(
      [sectionA, sectionB],
      [{ sectionId: 'A', repeats: 1 }, { sectionId: 'B', repeats: 1 }, { sectionId: 'A', repeats: 1 }],
      { bpm: 120 },
    );
    assert.equal(blocks[0].events, blocks[2].events);
  });

  it('lays out a multi-section arrangement with block-LOCAL event times', () => {
    const { blocks, totalMs } = compileArrangement(
      [sectionA, sectionB],
      [{ sectionId: 'A', repeats: 2 }, { sectionId: 'B', repeats: 1 }],
      { bpm: 120 },
    );
    assert.deepEqual(blocks.map((b) => [b.sectionId, b.repeatIdx, b.startMs]), [
      ['A', 0, 0], ['A', 1, 4000], ['B', 0, 8000],
    ]);
    assert.equal(totalMs, 10000);
    // B's events are local to the block: first event at 0, not 8000.
    const bOns = blocks[2].events.filter((e) => e.type === 'note_on');
    assert.equal(bOns[0].t, 0);
  });

  it('throws TypeError for an unknown sectionId', () => {
    assert.throws(
      () => compileArrangement([sectionA], [{ sectionId: 'ZZZ', repeats: 1 }], { bpm: 120 }),
      TypeError,
    );
  });

  it('coerces repeats: floor, min 1, non-numeric → 1', () => {
    const count = (repeats) =>
      compileArrangement([sectionA], [{ sectionId: 'A', repeats }], { bpm: 120 }).blocks.length;
    assert.equal(count(0), 1);
    assert.equal(count(-1), 1);
    assert.equal(count('x'), 1);
    assert.equal(count(undefined), 1);
    assert.equal(count(2.9), 2);
  });

  it('returns the empty compilation for empty arrangement or sections', () => {
    assert.deepEqual(compileArrangement([sectionA], [], { bpm: 120 }), { blocks: [], totalMs: 0 });
    assert.deepEqual(compileArrangement([], [], { bpm: 120 }), { blocks: [], totalMs: 0 });
  });
});

describe('nextJumpPoint', () => {
  // A(2 bars)×2 then B(1 bar)×1 @120bpm: blocks A0@0 A1@4000 B0@8000, totalMs 10000.
  const { blocks } = compileArrangement(
    [sectionA, sectionB],
    [{ sectionId: 'A', repeats: 2 }, { sectionId: 'B', repeats: 1 }],
    { bpm: 120 },
  );

  describe('repeat mode', () => {
    it('returns the end of the current block', () => {
      assert.equal(nextJumpPoint(5000, blocks, 'repeat', BAR_MS), 8000); // inside A1
    });

    it('at exactly a block boundary, belongs to the block STARTING there', () => {
      assert.equal(nextJumpPoint(0, blocks, 'repeat', BAR_MS), 4000); // start of A0 → A0's end
      assert.equal(nextJumpPoint(4000, blocks, 'repeat', BAR_MS), 8000); // start of A1 → A1's end
    });
  });

  describe('bar mode', () => {
    it('returns the next bar boundary', () => {
      assert.equal(nextJumpPoint(4500, blocks, 'bar', BAR_MS), 6000);
    });

    it('at exactly a bar boundary, fires at the NEXT bar (strict >)', () => {
      assert.equal(nextJumpPoint(6000, blocks, 'bar', BAR_MS), 8000);
    });

    it('bar boundary coinciding with block end is fine', () => {
      assert.equal(nextJumpPoint(7500, blocks, 'bar', BAR_MS), 8000);
      assert.equal(nextJumpPoint(9500, blocks, 'bar', BAR_MS), 10000); // naive next bar == block end
    });

    it('never lands past the current block end (clamps to block end)', () => {
      // barMs 3000: position 8500 → next bar 9000, inside B0 — fine.
      assert.equal(nextJumpPoint(8500, blocks, 'bar', 3000), 9000);
      // position 9200 → naive next bar 12000 > B0's end 10000 → clamped to 10000.
      assert.equal(nextJumpPoint(9200, blocks, 'bar', 3000), 10000);
    });
  });

  it('wraps to start (0) when positionMs is at/beyond totalMs or blocks are empty', () => {
    assert.equal(nextJumpPoint(10000, blocks, 'repeat', BAR_MS), 0); // exactly totalMs
    assert.equal(nextJumpPoint(15000, blocks, 'repeat', BAR_MS), 0);
    assert.equal(nextJumpPoint(15000, blocks, 'bar', BAR_MS), 0);
    assert.equal(nextJumpPoint(5000, [], 'repeat', BAR_MS), 0);
    assert.equal(nextJumpPoint(5000, [], 'bar', BAR_MS), 0);
  });
});
