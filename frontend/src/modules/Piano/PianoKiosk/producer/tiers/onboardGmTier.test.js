import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOnboardGmTier } from './onboardGmTier.js';

// ── logging mock (same pattern as voiceRouter.test.js) ──────────────────────
const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [], sampled: [] }));
vi.mock('../../../../../lib/logging/Logger.js', () => ({
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

function makeSendMidi({ connected = true } = {}) {
  return {
    isConnected: vi.fn(() => connected),
    sendNote: vi.fn(() => true),
    sendNoteOff: vi.fn(() => true),
    sendProgramChange: vi.fn(() => true),
    sendControlChange: vi.fn(() => true),
  };
}

beforeEach(() => {
  for (const k of Object.keys(logCalls)) logCalls[k].length = 0;
});

describe('createOnboardGmTier', () => {
  it('has id "onboard-gm"', () => {
    expect(createOnboardGmTier({ sendMidi: makeSendMidi(), enabled: true }).id).toBe('onboard-gm');
  });

  describe('supports()', () => {
    it('is true when enabled and the BLE output is connected', () => {
      const tier = createOnboardGmTier({ sendMidi: makeSendMidi(), enabled: true });
      expect(tier.supports(0)).toBe(true);
      expect(tier.supports(9)).toBe(true);
    });

    it('is false when the capability flag is off, even if connected', () => {
      const tier = createOnboardGmTier({ sendMidi: makeSendMidi(), enabled: false });
      expect(tier.supports(0)).toBe(false);
    });

    it('is false when the BLE output is disconnected (router falls to tier 2)', () => {
      const tier = createOnboardGmTier({ sendMidi: makeSendMidi({ connected: false }), enabled: true });
      expect(tier.supports(0)).toBe(false);
    });

    it('is false (not a throw) when sendMidi is missing or isConnected throws', () => {
      expect(createOnboardGmTier({ sendMidi: null, enabled: true }).supports(0)).toBe(false);
      const bag = makeSendMidi();
      bag.isConnected = vi.fn(() => { throw new Error('boom'); });
      expect(createOnboardGmTier({ sendMidi: bag, enabled: true }).supports(0)).toBe(false);
    });
  });

  describe('noteOn / noteOff', () => {
    it('noteOn maps (ch, note, vel) → sendNote(note, vel, ch) at default gain 1', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.noteOn(3, 60, 100);
      expect(bag.sendNote).toHaveBeenCalledWith(60, 100, 3);
    });

    it('noteOff maps (ch, note) → sendNoteOff(note, ch)', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.noteOff(3, 60);
      expect(bag.sendNoteOff).toHaveBeenCalledWith(60, 3);
    });
  });

  describe('setGain → velocity scaling (Roland CC7 untrusted)', () => {
    it('scales outgoing noteOn velocity by the stored per-channel gain', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.setGain(0, 0.5);
      tier.noteOn(0, 60, 100);
      expect(bag.sendNote).toHaveBeenCalledWith(60, 50, 0);
    });

    it('clamps the scaled velocity to a floor of 1 (never a silent/off 0)', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.setGain(0, 0.001);
      tier.noteOn(0, 60, 40);
      expect(bag.sendNote).toHaveBeenCalledWith(60, 1, 0);
    });

    it('caps the scaled velocity at 127 (7-bit MIDI; no wraparound via &0x7f)', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.setGain(0, 2);
      tier.noteOn(0, 60, 100);
      expect(bag.sendNote).toHaveBeenCalledWith(60, 127, 0);
    });

    it('gain is per-channel: another channel keeps default gain 1', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.setGain(0, 0.25);
      tier.noteOn(1, 62, 80);
      expect(bag.sendNote).toHaveBeenCalledWith(62, 80, 1);
    });
  });

  describe('setProgram', () => {
    it('routes program change with the channel', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.setProgram(4, 42);
      expect(bag.sendProgramChange).toHaveBeenCalledWith(42, 4);
    });
  });

  describe('allNotesOff', () => {
    it('sends CC123 value 0 on the given channel', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.allNotesOff(5);
      expect(bag.sendControlChange).toHaveBeenCalledTimes(1);
      expect(bag.sendControlChange).toHaveBeenCalledWith(123, 0, 5);
    });

    it('sends CC123 on all 16 channels when called with no argument', () => {
      const bag = makeSendMidi();
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      tier.allNotesOff();
      expect(bag.sendControlChange).toHaveBeenCalledTimes(16);
      for (let ch = 0; ch < 16; ch++) {
        expect(bag.sendControlChange).toHaveBeenCalledWith(123, 0, ch);
      }
    });
  });

  describe('never throws (senders may explode mid-performance)', () => {
    it('catches and logs a throwing sender on every op', () => {
      const bag = {
        isConnected: () => true,
        sendNote: () => { throw new Error('ble gone'); },
        sendNoteOff: () => { throw new Error('ble gone'); },
        sendProgramChange: () => { throw new Error('ble gone'); },
        sendControlChange: () => { throw new Error('ble gone'); },
      };
      const tier = createOnboardGmTier({ sendMidi: bag, enabled: true });
      expect(() => tier.noteOn(0, 60, 100)).not.toThrow();
      expect(() => tier.noteOff(0, 60)).not.toThrow();
      expect(() => tier.setProgram(0, 5)).not.toThrow();
      expect(() => tier.setGain(0, 0.5)).not.toThrow(); // pure store, but must not throw either
      expect(() => tier.allNotesOff(0)).not.toThrow();
      expect(() => tier.allNotesOff()).not.toThrow();
      const logged = logCalls.sampled.length + logCalls.warn.length;
      expect(logged).toBeGreaterThan(0);
    });

    it('ops are safe no-ops when sendMidi is missing entirely', () => {
      const tier = createOnboardGmTier({ sendMidi: null, enabled: true });
      expect(() => tier.noteOn(0, 60, 100)).not.toThrow();
      expect(() => tier.noteOff(0, 60)).not.toThrow();
      expect(() => tier.setProgram(0, 5)).not.toThrow();
      expect(() => tier.allNotesOff()).not.toThrow();
    });
  });
});
