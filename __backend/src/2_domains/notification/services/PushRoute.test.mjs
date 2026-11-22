import { describe, it, expect } from 'vitest';
import { choosePushTransport } from './PushRoute.mjs';

const nowMs = 1_000_000;
describe('choosePushTransport', () => {
  it('uses Home Assistant when no phone is known', () => {
    expect(choosePushTransport({ phone: null, nowMs })).toBe('ha');
  });
  it('uses the Android app when the phone said hello 89 s ago', () => {
    expect(choosePushTransport({ phone: { connectionId: 'c1', lastSeenMs: nowMs - 89_000 }, nowMs })).toBe('android');
  });
  it('uses Home Assistant when the last hello is 91 s old', () => {
    expect(choosePushTransport({ phone: { connectionId: 'c1', lastSeenMs: nowMs - 91_000 }, nowMs })).toBe('ha');
  });
  it('uses Home Assistant when the phone is fresh but has no connection', () => {
    expect(choosePushTransport({ phone: { connectionId: null, lastSeenMs: nowMs }, nowMs })).toBe('ha');
  });
});

describe('choosePushTransport with actions', () => {
  it('uses Home Assistant for a push that carries answerable actions, even with a fresh phone', () => {
    expect(choosePushTransport({ phone: { connectionId: 'c1', lastSeenMs: nowMs }, nowMs, answerable: true })).toBe('ha');
  });
});
