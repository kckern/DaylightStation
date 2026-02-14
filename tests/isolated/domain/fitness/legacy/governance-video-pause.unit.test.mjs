import { describe, test, expect } from 'vitest';
import { resolvePause, PAUSE_REASON } from '../../../../../frontend/src/modules/Player/utils/pauseArbiter.js';

describe('Governance video pause contract', () => {

  test('governance lock pauses video (not just mutes)', () => {
    const result = resolvePause({ governance: { locked: true } });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
    expect(result.reason).toBe('PAUSED_GOVERNANCE');
  });

  test('governance.blocked also triggers pause', () => {
    const result = resolvePause({ governance: { blocked: true } });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
  });

  test('governance.videoLocked also triggers pause', () => {
    const result = resolvePause({ governance: { videoLocked: true } });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
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
    // Must be GOVERNANCE, not USER - governance is the controlling reason
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
    expect(result.reason).not.toBe(PAUSE_REASON.USER);
  });

  test('governance pause takes priority over buffering pause', () => {
    const result = resolvePause({
      governance: { locked: true },
      resilience: { buffering: true }
    });

    expect(result.paused).toBe(true);
    expect(result.reason).toBe(PAUSE_REASON.GOVERNANCE);
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
