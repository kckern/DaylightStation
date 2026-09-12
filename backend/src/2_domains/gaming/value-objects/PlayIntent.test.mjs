import { describe, it, expect } from 'vitest';
import { PlayIntent } from './PlayIntent.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const at = (s) => new Date(T0 + s * 1000).toISOString();
const CONTENT = { contentId: 'game:a', title: 'Game A' };

const intent = (over = {}) => new PlayIntent({
  deviceId: 'livingroom-tv', surface: 'console-emulator', userId: 'test-learner',
  content: CONTENT, grantRef: 'grant_1',
  requestedAt: at(0), expiresAt: at(600), ...over,
});

describe('PlayIntent — it must name what it authorises', () => {
  it('requires content', () => {
    expect(() => intent({ content: null })).toThrow(/contentId/);
    expect(() => intent({ content: {} })).toThrow(/contentId/);
  });

  it('requires a device and a surface', () => {
    expect(() => intent({ deviceId: null })).toThrow(/deviceId/);
    expect(() => intent({ surface: null })).toThrow(/surface/);
  });

  it('is immutable once created', () => {
    const i = intent();
    expect(() => { i.userId = 'someone-else'; }).toThrow();
  });
});

describe('PlayIntent — it must expire', () => {
  it('requires an expiry after the request', () => {
    expect(() => intent({ expiresAt: at(0) })).toThrow(/after requestedAt/);
    expect(() => intent({ expiresAt: at(-10) })).toThrow(/after requestedAt/);
  });

  it('is live inside its window and expired past it', () => {
    const i = intent();
    expect(i.isExpired(at(599))).toBe(false);
    expect(i.isExpired(at(600))).toBe(true);
    expect(i.isExpired(at(601))).toBe(true);
  });

  it('survives a walk to another room', () => {
    // The authorisation happens at a reader elsewhere; the window has to be
    // generous enough that walking back does not void it.
    expect(intent().isExpired(at(240))).toBe(false);
  });
});

describe('PlayIntent — scope', () => {
  it('authorises only its own device', () => {
    const i = intent();
    expect(i.authorizes({ deviceId: 'livingroom-tv', contentId: 'game:a' })).toBe(true);
    expect(i.authorizes({ deviceId: 'garage-tv', contentId: 'game:a' })).toBe(false);
  });

  it('does not authorise a different title', () => {
    expect(intent().authorizes({ deviceId: 'livingroom-tv', contentId: 'game:b' })).toBe(false);
  });

  it('accepts an unidentified title on the right device', () => {
    // The inferred source can confirm that a game runs but not which one, so a
    // null contentId is "unknown", not "wrong".
    expect(intent().authorizes({ deviceId: 'livingroom-tv', contentId: null })).toBe(true);
  });
});

describe('PlayIntent — persistence', () => {
  it('round-trips through a snapshot', () => {
    const revived = PlayIntent.fromSnapshot(intent().toSnapshot());
    expect(revived.userId).toBe('test-learner');
    expect(revived.grantRef).toBe('grant_1');
    expect(revived.content).toEqual(CONTENT);
    expect(revived.isExpired(at(700))).toBe(true);
  });
});
