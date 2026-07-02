import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVoiceRouter } from './voiceRouter.js';

// ── logging mock (same pattern as gmSynth.test.js) ──────────────────────────
const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [], sampled: [] }));
vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      debug: (...a) => logCalls.debug.push(a),
      info: (...a) => logCalls.info.push(a),
      warn: (...a) => logCalls.warn.push(a),
      error: (...a) => logCalls.error.push(a),
      sampled: (...a) => logCalls.sampled.push(a),
    }),
  }),
}));

const sampledEvents = () => logCalls.sampled.map(([event]) => event);

// ── mock tier factory ────────────────────────────────────────────────────────
function makeTier(id, { supports = () => true } = {}) {
  return {
    id,
    supports: vi.fn(supports),
    noteOn: vi.fn(),
    noteOff: vi.fn(),
    setProgram: vi.fn(),
    setGain: vi.fn(),
    allNotesOff: vi.fn(),
  };
}

beforeEach(() => {
  for (const k of Object.keys(logCalls)) logCalls[k].length = 0;
});

describe('createVoiceRouter', () => {
  it('logs creation with tier ids', () => {
    createVoiceRouter({ tiers: [makeTier('a'), makeTier('b')] });
    const created = logCalls.info.find(([event]) => event === 'voice-router.created');
    expect(created).toBeTruthy();
    expect(created[1].tiers).toEqual(['a', 'b']);
  });

  describe('priority routing', () => {
    it('dispatches noteOn to the FIRST tier whose supports(channel) is true', () => {
      const a = makeTier('a');
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100);

      expect(a.noteOn).toHaveBeenCalledWith(0, 60, 100);
      expect(b.noteOn).not.toHaveBeenCalled();
    });

    it('falls through to the second tier when the first does not support the channel (drums)', () => {
      const a = makeTier('a', { supports: (ch) => ch !== 9 });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(9, 36, 110);

      expect(a.noteOn).not.toHaveBeenCalled();
      expect(b.noteOn).toHaveBeenCalledWith(9, 36, 110);
    });
  });

  describe('sticky note-off (tier flapping mid-note)', () => {
    it('routes noteOff to the tier that accepted the noteOn even if supports() flipped false', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100);
      expect(a.noteOn).toHaveBeenCalledWith(0, 60, 100);

      aSupports = false; // tier A flaps mid-note
      router.noteOff(0, 60);

      expect(a.noteOff).toHaveBeenCalledWith(0, 60);
      expect(b.noteOff).not.toHaveBeenCalled();
    });

    it('clears the memory after noteOff: a repeat noteOff goes best-effort to the first supporting tier', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100);
      aSupports = false;
      router.noteOff(0, 60); // sticky → A, memory cleared
      router.noteOff(0, 60); // no memory → best-effort first supporting = B

      expect(a.noteOff).toHaveBeenCalledTimes(1);
      expect(b.noteOff).toHaveBeenCalledWith(0, 60);
    });

    it('cross-tier retrigger: the OLD tier gets a best-effort noteOff before the memory moves to the new tier', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100); // held on A
      aSupports = false;         // A flaps
      router.noteOn(0, 60, 90);  // retrigger lands on B

      // A's sounding voice was cut (even though its supports() is now false),
      // before B's memory took over.
      expect(a.noteOff).toHaveBeenCalledWith(0, 60);
      expect(b.noteOn).toHaveBeenCalledWith(0, 60, 90);

      router.noteOff(0, 60); // sticky off now belongs to B
      expect(b.noteOff).toHaveBeenCalledWith(0, 60);
      expect(a.noteOff).toHaveBeenCalledTimes(1); // only the synthetic cut
    });

    it('same-tier retrigger does NOT get a synthetic off (tier handles it natively)', () => {
      const a = makeTier('a');
      const router = createVoiceRouter({ tiers: [a] });

      router.noteOn(0, 60, 100);
      router.noteOn(0, 60, 90); // retrigger on the same tier

      expect(a.noteOn).toHaveBeenCalledTimes(2);
      expect(a.noteOff).not.toHaveBeenCalled();
    });

    it('cross-tier retrigger survives the old tier throwing on the synthetic off', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      a.noteOff.mockImplementation(() => { throw new Error('boom'); });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100);
      aSupports = false;
      expect(() => router.noteOn(0, 60, 90)).not.toThrow();
      expect(b.noteOn).toHaveBeenCalledWith(0, 60, 90);
      expect(sampledEvents()).toContain('voice-router.tier-error');
    });

    it('routes an unknown noteOff (no remembered on) to the first supporting tier', () => {
      const a = makeTier('a');
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOff(2, 40);

      expect(a.noteOff).toHaveBeenCalledWith(2, 40);
      expect(b.noteOff).not.toHaveBeenCalled();
    });
  });

  describe('velocity-0 normalization', () => {
    it('treats noteOn(ch, n, 0) exactly as noteOff: routes to remembered tier, fires onNotes off', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      const b = makeTier('b');
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a, b], onNotes });

      router.noteOn(0, 60, 100);
      aSupports = false; // sticky routing must still hold through vel-0
      router.noteOn(0, 60, 0);

      expect(a.noteOff).toHaveBeenCalledWith(0, 60);
      expect(a.noteOn).toHaveBeenCalledTimes(1); // vel-0 never reaches tier noteOn
      expect(b.noteOn).not.toHaveBeenCalled();
      expect(onNotes).toHaveBeenLastCalledWith({ type: 'off', channel: 0, note: 60 });
    });

    it('treats non-finite velocity (undefined/null/NaN) as noteOff too', () => {
      const a = makeTier('a');
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a], onNotes });

      router.noteOn(0, 60, 100);
      router.noteOn(0, 60, undefined);

      expect(a.noteOff).toHaveBeenCalledWith(0, 60);
      expect(a.noteOn).toHaveBeenCalledTimes(1); // undefined never reaches tier noteOn
      expect(onNotes).toHaveBeenLastCalledWith({ type: 'off', channel: 0, note: 60 });

      router.noteOn(1, 61, null);
      router.noteOn(1, 61, NaN);
      expect(a.noteOn).toHaveBeenCalledTimes(1); // still only the one real noteOn
    });
  });

  describe('failover on tier error', () => {
    it('tries the next supporting tier when noteOn throws, and remembers the tier that accepted', () => {
      const a = makeTier('a');
      a.noteOn.mockImplementation(() => { throw new Error('BLE send failed'); });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100);
      expect(b.noteOn).toHaveBeenCalledWith(0, 60, 100);

      router.noteOff(0, 60); // must go to B (the tier that actually accepted)
      expect(b.noteOff).toHaveBeenCalledWith(0, 60);
      expect(a.noteOff).not.toHaveBeenCalled();

      expect(sampledEvents()).toContain('voice-router.tier-error');
    });

    it('drops the note (no throw) when every supporting tier errors', () => {
      const a = makeTier('a');
      a.noteOn.mockImplementation(() => { throw new Error('boom'); });
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a], onNotes });

      expect(() => router.noteOn(0, 60, 100)).not.toThrow();
      expect(onNotes).not.toHaveBeenCalled();
      expect(sampledEvents()).toContain('voice-router.note-dropped');
    });

    it('never throws when a tier noteOff errors', () => {
      const a = makeTier('a');
      a.noteOff.mockImplementation(() => { throw new Error('boom'); });
      const router = createVoiceRouter({ tiers: [a] });

      router.noteOn(0, 60, 100);
      expect(() => router.noteOff(0, 60)).not.toThrow();
      expect(sampledEvents()).toContain('voice-router.tier-error');
    });
  });

  describe('configureLayer', () => {
    it('fans setProgram/setGain to EVERY supporting tier', () => {
      const a = makeTier('a');
      const b = makeTier('b');
      const c = makeTier('c', { supports: () => false });
      const router = createVoiceRouter({ tiers: [a, b, c] });

      router.configureLayer(3, { program: 33, gain: 0.5 });

      expect(a.setProgram).toHaveBeenCalledWith(3, 33);
      expect(a.setGain).toHaveBeenCalledWith(3, 0.5);
      expect(b.setProgram).toHaveBeenCalledWith(3, 33);
      expect(b.setGain).toHaveBeenCalledWith(3, 0.5);
      expect(c.setProgram).not.toHaveBeenCalled();
      expect(c.setGain).not.toHaveBeenCalled();
    });

    it('skips undefined fields', () => {
      const a = makeTier('a');
      const router = createVoiceRouter({ tiers: [a] });

      router.configureLayer(0, { program: 12 });
      expect(a.setProgram).toHaveBeenCalledWith(0, 12);
      expect(a.setGain).not.toHaveBeenCalled();

      router.configureLayer(0, { gain: 0.8 });
      expect(a.setGain).toHaveBeenCalledWith(0, 0.8);
      expect(a.setProgram).toHaveBeenCalledTimes(1);
    });

    it('survives a tier setProgram throwing and still configures the other tiers', () => {
      const a = makeTier('a');
      a.setProgram.mockImplementation(() => { throw new Error('boom'); });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      expect(() => router.configureLayer(0, { program: 5, gain: 0.7 })).not.toThrow();
      expect(a.setGain).toHaveBeenCalledWith(0, 0.7); // error on setProgram doesn't skip setGain
      expect(b.setProgram).toHaveBeenCalledWith(0, 5);
      expect(b.setGain).toHaveBeenCalledWith(0, 0.7);
    });
  });

  describe('panic', () => {
    it('calls allNotesOff() on every tier, including non-supporting ones', () => {
      const a = makeTier('a');
      const b = makeTier('b', { supports: () => false });
      const router = createVoiceRouter({ tiers: [a, b] });

      router.panic();

      expect(a.allNotesOff).toHaveBeenCalledWith();
      expect(b.allNotesOff).toHaveBeenCalledWith();
    });

    it('clears note memory: a post-panic noteOff of a pre-panic note takes the best-effort path', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      router.noteOn(0, 60, 100);
      router.panic();
      aSupports = false; // if memory survived panic, the off would stick to A
      router.noteOff(0, 60);

      expect(a.noteOff).not.toHaveBeenCalled();
      expect(b.noteOff).toHaveBeenCalledWith(0, 60); // best-effort first supporting
    });

    it('never throws when a tier allNotesOff errors', () => {
      const a = makeTier('a');
      a.allNotesOff.mockImplementation(() => { throw new Error('boom'); });
      const b = makeTier('b');
      const router = createVoiceRouter({ tiers: [a, b] });

      expect(() => router.panic()).not.toThrow();
      expect(b.allNotesOff).toHaveBeenCalled();
    });
  });

  describe('allNotesOff(channel)', () => {
    it('calls allNotesOff(channel) on every supporting tier and clears that channel memory only', () => {
      let aSupports = true;
      const a = makeTier('a', { supports: () => aSupports });
      const b = makeTier('b');
      const c = makeTier('c', { supports: () => false });
      const router = createVoiceRouter({ tiers: [a, b, c] });

      router.noteOn(0, 60, 100); // → A (cleared by allNotesOff(0))
      router.noteOn(1, 61, 100); // → A (memory must survive)
      router.allNotesOff(0);

      expect(a.allNotesOff).toHaveBeenCalledWith(0);
      expect(b.allNotesOff).toHaveBeenCalledWith(0);
      expect(c.allNotesOff).not.toHaveBeenCalled();

      aSupports = false;
      router.noteOff(0, 60); // memory cleared → best-effort → B
      expect(b.noteOff).toHaveBeenCalledWith(0, 60);
      router.noteOff(1, 61); // memory intact → sticky → A
      expect(a.noteOff).toHaveBeenCalledWith(1, 61);
    });
  });

  describe('no supporting tier', () => {
    it('drops the note silently with a sampled log; onNotes is NOT called', () => {
      const a = makeTier('a', { supports: () => false });
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a], onNotes });

      expect(() => router.noteOn(5, 60, 100)).not.toThrow();
      expect(() => router.noteOff(5, 60)).not.toThrow();
      expect(a.noteOn).not.toHaveBeenCalled();
      expect(a.noteOff).not.toHaveBeenCalled();
      expect(onNotes).not.toHaveBeenCalled();
      expect(sampledEvents()).toContain('voice-router.note-dropped');
    });

    it('handles an empty tiers array without throwing', () => {
      const router = createVoiceRouter({ tiers: [] });
      expect(() => {
        router.noteOn(0, 60, 100);
        router.noteOff(0, 60);
        router.configureLayer(0, { program: 1, gain: 1 });
        router.allNotesOff(0);
        router.panic();
      }).not.toThrow();
    });
  });

  describe('onNotes tap', () => {
    it('fires with exact payloads AFTER successful dispatch', () => {
      const a = makeTier('a');
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a], onNotes });

      router.noteOn(2, 64, 90);
      expect(onNotes).toHaveBeenCalledTimes(1);
      expect(onNotes).toHaveBeenCalledWith({ type: 'on', channel: 2, note: 64 });

      router.noteOff(2, 64);
      expect(onNotes).toHaveBeenCalledTimes(2);
      expect(onNotes).toHaveBeenLastCalledWith({ type: 'off', channel: 2, note: 64 });
    });

    it('does not filter channels (caller decides what to visualize)', () => {
      const a = makeTier('a');
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a], onNotes });

      router.noteOn(9, 36, 100); // drums flow through the tap too
      expect(onNotes).toHaveBeenCalledWith({ type: 'on', channel: 9, note: 36 });
    });

    it('does not crash without a tap', () => {
      const a = makeTier('a');
      const router = createVoiceRouter({ tiers: [a] });
      expect(() => {
        router.noteOn(0, 60, 100);
        router.noteOff(0, 60);
      }).not.toThrow();
    });

    it('a throwing tap never breaks the performance path', () => {
      const a = makeTier('a');
      const onNotes = vi.fn(() => { throw new Error('viz died'); });
      const router = createVoiceRouter({ tiers: [a], onNotes });

      expect(() => router.noteOn(0, 60, 100)).not.toThrow();
      expect(a.noteOn).toHaveBeenCalledWith(0, 60, 100);
      expect(() => router.noteOff(0, 60)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('panics (allNotesOff on every tier) and makes subsequent calls silent no-ops', () => {
      const a = makeTier('a');
      const onNotes = vi.fn();
      const router = createVoiceRouter({ tiers: [a], onNotes });

      router.noteOn(0, 60, 100);
      router.dispose();
      expect(a.allNotesOff).toHaveBeenCalledWith();

      a.noteOn.mockClear();
      a.noteOff.mockClear();
      a.allNotesOff.mockClear();
      onNotes.mockClear();

      expect(() => {
        router.noteOn(0, 61, 100);
        router.noteOff(0, 61);
        router.configureLayer(0, { program: 1, gain: 1 });
        router.allNotesOff(0);
        router.panic();
        router.dispose();
      }).not.toThrow();

      expect(a.noteOn).not.toHaveBeenCalled();
      expect(a.noteOff).not.toHaveBeenCalled();
      expect(a.allNotesOff).not.toHaveBeenCalled();
      expect(a.setProgram).not.toHaveBeenCalled();
      expect(onNotes).not.toHaveBeenCalled();
    });
  });
});
