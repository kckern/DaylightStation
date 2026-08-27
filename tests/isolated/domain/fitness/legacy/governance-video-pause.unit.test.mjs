import { describe, test, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from '../../../../../frontend/src/lib/Player/gate/pauseArbiter.js';

describe('Governance video pause contract', () => {

  test('governance lock pauses video (not just mutes)', () => {
    const result = resolvePause({ governance: { locked: true } });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
    expect(result.reason).toBe('PAUSED_GATE');
  });

  test('governance.blocked also triggers pause', () => {
    const result = resolvePause({ governance: { blocked: true } });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });

  test('governance.videoLocked also triggers pause', () => {
    const result = resolvePause({ governance: { videoLocked: true } });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });

  test('governance unlock resumes playback (paused:false when not locked)', () => {
    const result = resolvePause({ governance: { locked: false } });

    expect(result.paused).toBe(false);
    expect(result.reason).toBe(PAUSE_REASON.PLAYING);
  });

  test('no governance state means not paused', () => {
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
      governance: { locked: true },
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
      governance: { locked: true },
      resilience: { buffering: true }
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
    expect(result.reason).not.toBe(PAUSE_REASON.BUFFERING);
  });

  test('user pause still works when governance is not locked', () => {
    const result = resolvePause({
      governance: { locked: false },
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
      governance: { locked: true }
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
      governance: { locked: true }
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });

  test('no seeking bucket does not suppress', () => {
    const result = resolvePause({
      governance: { locked: true }
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GATE);
    expect(result.gate).toBe('governance');
  });
});
