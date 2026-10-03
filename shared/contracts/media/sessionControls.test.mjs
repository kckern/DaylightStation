import { describe, it, expect } from 'vitest';
import {
  SESSION_ACTIONS,
  END_OF_QUEUE_MODES,
  SCREEN_NOTE_KINDS,
  START_PHASES,
  SLEEP_TIMER_MAX_MINUTES,
  isSessionAction,
  isEndOfQueueMode,
  validateSessionActionParams,
  validateSessionControls,
  createDefaultSessionControls,
  buildDeviceStartStatus,
  validateDeviceStartStatus,
} from './sessionControls.mjs';
import { DEVICE_START_TOPIC, parseDeviceTopic } from './topics.mjs';
import { COMMAND_KINDS, CONFIG_SETTINGS } from './commands.mjs';
import {
  buildCommandEnvelope, validateCommandEnvelope, buildCommandAck, validateCommandAck,
} from './envelopes.mjs';
import { createIdleSessionSnapshot, validateSessionSnapshot } from './shapes.mjs';

describe('session control enums', () => {
  it('lists every session action a screen accepts', () => {
    expect(SESSION_ACTIONS).toEqual([
      'sleep-timer', 'cancel-sleep-timer', 'resume-sleep', 'put-back', 'cancel-countdown', 'start-next-now',
    ]);
    expect(isSessionAction('put-back')).toBe(true);
    expect(isSessionAction('reboot')).toBe(false);
  });
  it('lists end-of-queue modes, note kinds and start phases', () => {
    expect(END_OF_QUEUE_MODES).toEqual(['stop', 'repeat', 'similar']);
    expect(isEndOfQueueMode('similar')).toBe(true);
    expect(isEndOfQueueMode('shuffle')).toBe(false);
    expect(SCREEN_NOTE_KINDS).toEqual(['paused', 'stopped', 'replaced', 'moved']);
    expect(START_PHASES).toEqual(['starting', 'delivered', 'queued', 'started', 'failed']);
  });
  it('adds the session command kind and the three session settings additively', () => {
    expect(COMMAND_KINDS).toContain('session');
    expect(CONFIG_SETTINGS).toEqual(['shuffle', 'repeat', 'shader', 'volume', 'addOnly', 'endOfQueue', 'stopAfterCurrent']);
  });
});

describe('validateSessionActionParams', () => {
  it('accepts a minutes sleep timer and an end-of-item sleep timer', () => {
    expect(validateSessionActionParams({ action: 'sleep-timer', minutes: 30 }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'sleep-timer', atEnd: 'item' }).valid).toBe(true);
  });
  it('rejects a sleep timer with neither, both, or out-of-range minutes', () => {
    expect(validateSessionActionParams({ action: 'sleep-timer' }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'sleep-timer', minutes: 5, atEnd: 'item' }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'sleep-timer', minutes: 0 }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'sleep-timer', minutes: SLEEP_TIMER_MAX_MINUTES + 1 }).valid).toBe(false);
    expect(validateSessionActionParams({ action: 'sleep-timer', atEnd: 'chapter' }).valid).toBe(false);
  });
  it('accepts the parameterless actions and an optional put-back note id', () => {
    for (const action of ['cancel-sleep-timer', 'resume-sleep', 'cancel-countdown', 'start-next-now', 'put-back']) {
      expect(validateSessionActionParams({ action }).valid).toBe(true);
    }
    expect(validateSessionActionParams({ action: 'put-back', noteId: 'n1' }).valid).toBe(true);
    expect(validateSessionActionParams({ action: 'put-back', noteId: 7 }).valid).toBe(false);
  });
  it('rejects an unknown action', () => {
    expect(validateSessionActionParams({ action: 'explode' }).valid).toBe(false);
  });
});

describe('session command envelopes', () => {
  it('validates a session command end to end', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv', command: 'session', commandId: 'c1',
      params: { action: 'sleep-timer', minutes: 20 },
      origin: { kind: 'device', id: 'browser:abc', name: "Dad's phone" },
    });
    expect(validateCommandEnvelope(env)).toEqual({ valid: true, errors: [] });
    const bad = buildCommandEnvelope({ targetDevice: 'tv', command: 'session', commandId: 'c2', params: { action: 'sleep-timer' } });
    expect(validateCommandEnvelope(bad).valid).toBe(false);
  });
  it('validates the three new config settings', () => {
    const ok = (setting, value) => validateCommandEnvelope(buildCommandEnvelope({
      targetDevice: 'tv', command: 'config', commandId: 'c', params: { setting, value },
    })).valid;
    expect(ok('addOnly', true)).toBe(true);
    expect(ok('addOnly', 'yes')).toBe(false);
    expect(ok('endOfQueue', 'similar')).toBe(true);
    expect(ok('endOfQueue', 'forever')).toBe(false);
    expect(ok('stopAfterCurrent', false)).toBe(true);
    expect(ok('stopAfterCurrent', 1)).toBe(false);
  });
  it('accepts a transport stop that names a move intent and rejects an unknown intent', () => {
    const env = (intent) => buildCommandEnvelope({
      targetDevice: 'tv', command: 'transport', commandId: 'c', params: { action: 'stop', intent },
    });
    expect(validateCommandEnvelope(env('move')).valid).toBe(true);
    expect(validateCommandEnvelope(env('steal')).valid).toBe(false);
  });
  it('caps the origin name length', () => {
    const env = (name) => buildCommandEnvelope({
      targetDevice: 'tv', command: 'transport', commandId: 'c', params: { action: 'pause' },
      origin: { kind: 'device', id: 'x', name },
    });
    expect(validateCommandEnvelope(env('a'.repeat(80))).valid).toBe(true);
    expect(validateCommandEnvelope(env('a'.repeat(81))).valid).toBe(false);
  });

  it('rejects a non-string origin name', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv', command: 'transport', commandId: 'c', params: { action: 'pause' },
      origin: { kind: 'device', id: 'x', name: 4 },
    });
    expect(validateCommandEnvelope(env).valid).toBe(false);
  });
});

describe('command ack — appliedAs', () => {
  it('carries how a queue command was actually applied', () => {
    const ack = buildCommandAck({ deviceId: 'tv', commandId: 'c', ok: true, appliedAs: 'add', requestedOp: 'play-now' });
    expect(ack).toMatchObject({ appliedAs: 'add', requestedOp: 'play-now' });
    expect(validateCommandAck(ack).valid).toBe(true);
    expect(validateCommandAck({ ...ack, appliedAs: 'teleport' }).valid).toBe(false);
  });
  it('omits appliedAs when not given', () => {
    expect(buildCommandAck({ deviceId: 'tv', commandId: 'c', ok: true })).not.toHaveProperty('appliedAs');
  });
});

describe('validateSessionControls', () => {
  const now = '2026-10-02T10:00:00.000Z';
  it('accepts the default controls', () => {
    expect(validateSessionControls(createDefaultSessionControls())).toEqual({ valid: true, errors: [] });
  });
  it('accepts a populated controls block', () => {
    const controls = {
      ...createDefaultSessionControls(),
      addOnly: true,
      endOfQueue: 'similar',
      stopAfterCurrent: true,
      sleepTimer: { mode: 'minutes', minutes: 30, setAt: now, endsAt: now, remainingSeconds: 12, fading: false,
        setPosition: { contentId: 'plex:1', queueItemId: 'q1', position: 42 } },
      sleepResume: { contentId: 'plex:1', queueItemId: 'q1', position: 42, setAt: now, stoppedAt: now },
      countdown: { seconds: 10, endsAt: now, remainingSeconds: 7, next: { contentId: 'plex:2', title: 'Two' } },
      endOfQueueStatus: { code: 'NOTHING_SIMILAR', message: 'Nothing similar left', at: now },
      notes: [{ id: 'n1', kind: 'paused', origin: { kind: 'device', id: 'browser:a' }, label: 'Paused by a',
        count: 2, at: now, putBack: { availableUntil: now } }],
    };
    expect(validateSessionControls(controls)).toEqual({ valid: true, errors: [] });
  });
  it('rejects bad fields', () => {
    const base = createDefaultSessionControls();
    expect(validateSessionControls({ ...base, addOnly: 'on' }).valid).toBe(false);
    expect(validateSessionControls({ ...base, endOfQueue: 'loop' }).valid).toBe(false);
    expect(validateSessionControls({ ...base, sleepTimer: { mode: 'hours' } }).valid).toBe(false);
    expect(validateSessionControls({ ...base, notes: [{ kind: 'volume' }] }).valid).toBe(false);
    expect(validateSessionControls(null).valid).toBe(false);
  });
  it('is checked as part of a session snapshot only when present', () => {
    const snap = createIdleSessionSnapshot({ sessionId: 's', ownerId: 'tv' });
    expect(validateSessionSnapshot(snap).valid).toBe(true);
    expect(validateSessionSnapshot({ ...snap, controls: createDefaultSessionControls() }).valid).toBe(true);
    expect(validateSessionSnapshot({ ...snap, controls: { ...createDefaultSessionControls(), endOfQueue: 'x' } }).valid).toBe(false);
  });
});

describe('device start status (RQ-HOUSE-04)', () => {
  it('builds and validates a start status message on the device-start topic', () => {
    const status = buildDeviceStartStatus({
      deviceId: 'tv', dispatchId: 'd1', phase: 'starting', step: 'power', stepStatus: 'running',
      updatedAt: '2026-10-02T10:00:00.000Z',
    });
    expect(status).toMatchObject({ topic: 'device-start', deviceId: 'tv', phase: 'starting', lastFailure: null });
    expect(validateDeviceStartStatus(status)).toEqual({ valid: true, errors: [] });
    expect(DEVICE_START_TOPIC('tv')).toBe('device-start:tv');
    expect(parseDeviceTopic('device-start:tv')).toEqual({ kind: 'device-start', deviceId: 'tv' });
  });
  it('requires a failure to carry its error', () => {
    const failed = buildDeviceStartStatus({
      deviceId: 'tv', dispatchId: 'd1', phase: 'failed', step: 'load', stepStatus: 'failed', error: 'boom',
      lastFailure: { dispatchId: 'd1', step: 'load', error: 'boom', at: '2026-10-02T10:00:00.000Z' },
      updatedAt: '2026-10-02T10:00:00.000Z',
    });
    expect(validateDeviceStartStatus(failed).valid).toBe(true);
    expect(validateDeviceStartStatus({ ...failed, lastFailure: { step: 'load' } }).valid).toBe(false);
    expect(validateDeviceStartStatus({ ...failed, phase: 'exploded' }).valid).toBe(false);
  });
});
