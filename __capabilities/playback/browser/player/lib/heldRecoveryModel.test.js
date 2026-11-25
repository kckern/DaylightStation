import { describe, it, expect } from 'vitest';
import { heldRecoveryModel, lowerQualityStep, AUTO_RETRY_LIMIT } from './heldRecoveryModel.js';

const base = {
  input: 'touch', state: 'exhausted', positionLabel: '1:13',
  next: null, retryAfterMs: 0, videoHeight: 1080, qualityHost: false, canChangeQuality: true,
};
const ids = (m) => m.actions.map((a) => a.id);

describe('heldRecoveryModel', () => {
  it('says what happened, never "Tap to Retry"', () => {
    const m = heldRecoveryModel(base);
    expect(m.headline).toBe('The video stopped loading');
    expect(m.detail).toBe('Stopped at 1:13');
  });

  it('touch: Try again first; no Skip on the last item; never a Close (the host has one)', () => {
    expect(ids(heldRecoveryModel(base))).toEqual(['retry', 'lower-quality']);
    expect(ids(heldRecoveryModel(base))).not.toContain('close');
  });

  it('Skip appears only with a next item, and names it', () => {
    const m = heldRecoveryModel({ ...base, next: { title: 'Week 4 Day 7 - Upper Body' } });
    const skip = m.actions.find((a) => a.id === 'skip');
    expect(skip.label).toBe('Skip to Week 4 Day 7 - Upper Body');
  });

  it('Lower quality steps 1080 -> 720 -> 480, and is absent at 480 or below, or when the source cannot change', () => {
    expect(heldRecoveryModel(base).actions.find((a) => a.id === 'lower-quality')).toMatchObject({ label: 'Lower quality (720p)', resolution: '720' });
    expect(heldRecoveryModel({ ...base, videoHeight: 720 }).actions.find((a) => a.id === 'lower-quality').resolution).toBe('480');
    expect(ids(heldRecoveryModel({ ...base, videoHeight: 480 }))).not.toContain('lower-quality');
    expect(ids(heldRecoveryModel({ ...base, videoHeight: null }))).not.toContain('lower-quality');
    expect(ids(heldRecoveryModel({ ...base, canChangeQuality: false }))).not.toContain('lower-quality');
  });

  it('a host with its own quality dialog (MediaApp) gets "Quality…" instead', () => {
    const m = heldRecoveryModel({ ...base, input: 'pointer', qualityHost: true });
    expect(m.actions.find((a) => a.id === 'quality')).toMatchObject({ label: 'Quality…' });
    expect(ids(m)).not.toContain('lower-quality');
  });

  it('a retry cooldown shows as a countdown on the action', () => {
    const retry = heldRecoveryModel({ ...base, retryAfterMs: 4200 }).actions[0];
    expect(retry).toMatchObject({ id: 'retry', label: 'Try again in 5s', disabled: true });
  });

  it('remote: buttons with a key line only when there is a choice to make', () => {
    const one = heldRecoveryModel({ ...base, input: 'remote', videoHeight: 480 });
    expect(ids(one)).toEqual(['retry']);
    expect(one.focusable).toBe(true);
    expect(one.keyHint).toBeNull();
    const many = heldRecoveryModel({ ...base, input: 'remote', next: { title: 'B' } });
    expect(many.keyHint).toBe('▲ ▼  Choose    OK  Select');
  });

  it('numpad: no buttons (it has no OK or arrows); names the keys that work', () => {
    const m = heldRecoveryModel({ ...base, input: 'numpad', next: { title: 'B' } });
    expect(m.actions).toEqual([]);
    expect(m.keyHint).toBe('Play/Pause  Try again    Next  Skip to B');
    expect(heldRecoveryModel({ ...base, input: 'numpad' }).keyHint).toBe('Play/Pause  Try again');
  });

  it('numpad: during the retry cooldown the key line says when Play/Pause will work', () => {
    expect(heldRecoveryModel({ ...base, input: 'numpad', retryAfterMs: 8100 }).keyHint).toBe('Play/Pause  Try again in 9s');
  });

  it('no input: no buttons; the card states the automatic plan', () => {
    const m = heldRecoveryModel({ ...base, input: 'none', autoAttempt: 1, autoRetryInSec: 20, next: { title: 'B' } });
    expect(m.actions).toEqual([]);
    expect(m.keyHint).toBeNull();
    expect(m.plan).toBe(`Trying again in 20s (attempt 2 of ${AUTO_RETRY_LIMIT})`);
    const spent = heldRecoveryModel({ ...base, input: 'none', autoAttempt: AUTO_RETRY_LIMIT, next: null });
    expect(spent.headline).toBe("This video couldn't be loaded");
    expect(spent.plan).toBeNull();
  });

  it('waiting on a source the server is repairing: says so, offers Skip only if something is next', () => {
    const m = heldRecoveryModel({ ...base, state: 'source-wait', sourceNotice: 'Plex is repairing this file' });
    expect(m.headline).toBe('Waiting for the video');
    expect(m.detail).toBe('Plex is repairing this file');
    expect(ids(m)).toEqual([]);
    expect(ids(heldRecoveryModel({ ...base, state: 'source-wait', sourceNotice: 'x', next: { title: 'B' } }))).toEqual(['skip']);
  });
});

describe('lowerQualityStep', () => {
  it('is the next rung below the playing height', () => {
    expect(lowerQualityStep(2160)).toBe('720');
    expect(lowerQualityStep(1080)).toBe('720');
    expect(lowerQualityStep(720)).toBe('480');
    expect(lowerQualityStep(576)).toBe('480');
    expect(lowerQualityStep(480)).toBeNull();
    expect(lowerQualityStep(undefined)).toBeNull();
  });
});
