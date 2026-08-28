import { describe, test, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from '../../../../../frontend/src/lib/Player/gate/pauseArbiter.js';

// Characterizes the governance gate exactly as FitnessPlayer passes it. This suite
// predates the N-ary arbiter and called a `governance:` alias slot; that alias is gone,
// so each call is now the gates form. The three "also triggers pause" cases were three
// distinct alias keys (blocked/locked/videoLocked) that collapse to one boolean, so they
// remain as redundant regression anchors rather than three separate behaviors.

describe('Governance video pause contract', () => {

  test('a blocked governance gate pauses video (not just mutes)', () => {
    const result = resolvePause({ gates: [{ blocked: true, id: 'governance', seekCeiling: null }] });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
    expect(result.reason).toBe('PAUSED_GATE');
  });

  test('a blocked governance gate triggers pause (was: governance.blocked)', () => {
    const result = resolvePause({ gates: [{ blocked: true, id: 'governance', seekCeiling: null }] });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });

  test('a blocked governance gate triggers pause (was: governance.videoLocked)', () => {
    const result = resolvePause({ gates: [{ blocked: true, id: 'governance', seekCeiling: null }] });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });

  test('a released governance gate resumes playback', () => {
    const result = resolvePause({ gates: [{ blocked: false, id: 'governance', seekCeiling: null }] });

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.PLAYING);
  });

  test('no gates at all means not paused', () => {
    const result = resolvePause({});

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.PLAYING);
  });

  test('default (no args) means not paused', () => {
    const result = resolvePause();

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.PLAYING);
  });

  test('governance pause takes priority over user pause', () => {
    const result = resolvePause({
      gates: [{ blocked: true, id: 'governance', seekCeiling: null }],
      user: { paused: true }
    });

    expect(result.paused).toBe(true);
    // Must be the governance GATE, not USER - the gate is the controlling reason
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
    expect(result.reason).not.toBe(PAUSE_REASON.USER);
  });

  test('governance pause takes priority over buffering pause', () => {
    const result = resolvePause({
      gates: [{ blocked: true, id: 'governance', seekCeiling: null }],
      resilience: { buffering: true }
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
    expect(result.reason).not.toBe(PAUSE_REASON.BUFFERING);
  });

  test('user pause still works when governance is not locked', () => {
    const result = resolvePause({
      gates: [{ blocked: false, id: 'governance', seekCeiling: null }],
      user: { paused: true }
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.USER);
  });
});

describe('Seeking suppresses pause', () => {

  test('seeking suppresses governance pause', () => {
    const result = resolvePause({
      seeking: { active: true },
      gates: [{ blocked: true, id: 'governance', seekCeiling: null }]
    });

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.SEEKING);
  });

  test('seeking suppresses buffering pause', () => {
    const result = resolvePause({
      seeking: { active: true },
      resilience: { buffering: true }
    });

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.SEEKING);
  });

  test('seeking suppresses user pause', () => {
    const result = resolvePause({
      seeking: { active: true },
      user: { paused: true }
    });

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.SEEKING);
  });

  test('seeking:false does not suppress', () => {
    const result = resolvePause({
      seeking: { active: false },
      gates: [{ blocked: true, id: 'governance', seekCeiling: null }]
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });

  test('no seeking bucket does not suppress', () => {
    const result = resolvePause({
      gates: [{ blocked: true, id: 'governance', seekCeiling: null }]
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });
});
