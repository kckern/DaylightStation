import { describe, it, expect } from 'vitest';
import {
  buildCommandEnvelope,
  validateCommandEnvelope,
  buildCommandAck,
  validateCommandAck,
  buildDeviceStateBroadcast,
  validateDeviceStateBroadcast,
  buildPlaybackStateBroadcast,
} from './envelopes.mjs';
import { createIdleSessionSnapshot } from './shapes.mjs';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

function makeSnapshot() {
  return createIdleSessionSnapshot({ sessionId: 's1', ownerId: 'tv-1' });
}

describe('buildCommandEnvelope', () => {
  it('builds a valid transport envelope with default ts', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'transport',
      params: { action: 'play' },
      commandId: 'cmd-1',
    });
    expect(env.type).toBe('command');
    expect(env.targetDevice).toBe('tv-1');
    expect(env.command).toBe('transport');
    expect(env.params).toEqual({ action: 'play' });
    expect(env.commandId).toBe('cmd-1');
    expect(typeof env.ts).toBe('string');
    expect(ISO_RE.test(env.ts)).toBe(true);
  });

  it('includes targetScreen when provided', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      targetScreen: 'primary',
      command: 'transport',
      params: { action: 'pause' },
      commandId: 'cmd-2',
    });
    expect(env.targetScreen).toBe('primary');
  });

  it('passes through provided ts', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'transport',
      params: { action: 'play' },
      commandId: 'cmd-3',
      ts,
    });
    expect(env.ts).toBe(ts);
  });

  it('throws TypeError on unknown command kind', () => {
    expect(() => buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'bogus',
      params: {},
      commandId: 'cmd-x',
    })).toThrow(TypeError);
    expect(() => buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'bogus',
      params: {},
      commandId: 'cmd-x',
    })).toThrow(/unknown command kind/);
  });
});

describe('validateCommandEnvelope — happy paths', () => {
  it('accepts a transport play envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'transport',
      params: { action: 'play' },
      commandId: 'c1',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a transport seekAbs envelope with numeric value', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'transport',
      params: { action: 'seekAbs', value: 42 },
      commandId: 'c2',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a queue play-now envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'queue',
      params: { op: 'play-now', contentId: 'plex:1' },
      commandId: 'c3',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a queue reorder envelope with from/to', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'queue',
      params: { op: 'reorder', from: 'q1', to: 'q2' },
      commandId: 'c4',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a queue reorder envelope with items array', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'queue',
      params: { op: 'reorder', items: ['q1', 'q2', 'q3'] },
      commandId: 'c4b',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a queue clear envelope with no extra params', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'queue',
      params: { op: 'clear' },
      commandId: 'c5',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a config shuffle envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'config',
      params: { setting: 'shuffle', value: true },
      commandId: 'c6',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a config repeat envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'config',
      params: { setting: 'repeat', value: 'all' },
      commandId: 'c7',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a config shader envelope with null value', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'config',
      params: { setting: 'shader', value: null },
      commandId: 'c8',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a config volume envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'config',
      params: { setting: 'volume', value: 75 },
      commandId: 'c9',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts an adopt-snapshot envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'adopt-snapshot',
      params: { snapshot: makeSnapshot(), autoplay: true },
      commandId: 'c10',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });

  it('accepts a system action envelope', () => {
    const env = buildCommandEnvelope({
      targetDevice: 'tv-1',
      command: 'system',
      params: { action: 'reload' },
      commandId: 'c11',
    });
    expect(validateCommandEnvelope(env).valid).toBe(true);
  });
});

describe('validateCommandEnvelope — failure cases', () => {
  it('rejects a non-object envelope', () => {
    const r = validateCommandEnvelope(null);
    expect(r.valid).toBe(false);
  });

  it('rejects an envelope missing commandId', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      command: 'transport',
      params: { action: 'play' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('commandid'))).toBe(true);
  });

  it('rejects an envelope missing command', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      params: {},
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('command'))).toBe(true);
  });

  it('rejects an envelope with unknown command kind', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'bogus',
      params: {},
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.toLowerCase().includes('unknown'))).toBe(true);
  });

  it('rejects a transport envelope missing action', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'transport',
      params: {},
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a transport seekAbs missing value', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'transport',
      params: { action: 'seekAbs' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a transport seekRel with non-numeric value', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'transport',
      params: { action: 'seekRel', value: 'fast' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a queue envelope missing op', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'queue',
      params: {},
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a queue play-now missing contentId', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'queue',
      params: { op: 'play-now' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a queue remove missing queueItemId', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'queue',
      params: { op: 'remove' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a queue jump missing queueItemId', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'queue',
      params: { op: 'jump' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a queue reorder with neither from/to nor items', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'queue',
      params: { op: 'reorder' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a queue reorder with empty items array', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'queue',
      params: { op: 'reorder', items: [] },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config envelope missing setting', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { value: 50 },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config envelope with unknown setting', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { setting: 'brightness', value: 50 },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config volume out of range', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { setting: 'volume', value: 150 },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config volume that is non-integer', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { setting: 'volume', value: 50.5 },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config repeat with unknown mode', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { setting: 'repeat', value: 'sometimes' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config shuffle with non-boolean value', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { setting: 'shuffle', value: 'yes' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a config shader with non-string/non-null value', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'config',
      params: { setting: 'shader', value: 42 },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects an adopt-snapshot missing snapshot', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'adopt-snapshot',
      params: {},
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects an adopt-snapshot with invalid snapshot', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'adopt-snapshot',
      params: { snapshot: { state: 'DANCING' } },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });

  it('rejects a system envelope with invalid action', () => {
    const r = validateCommandEnvelope({
      type: 'command',
      targetDevice: 'tv-1',
      commandId: 'c1',
      command: 'system',
      params: { action: 'explode' },
      ts: new Date().toISOString(),
    });
    expect(r.valid).toBe(false);
  });
});

describe('buildCommandAck / validateCommandAck', () => {
  it('builds a valid ok ack', () => {
    const ack = buildCommandAck({ deviceId: 'tv-1', commandId: 'c1', ok: true });
    expect(ack.topic).toBe('device-ack');
    expect(ack.deviceId).toBe('tv-1');
    expect(ack.commandId).toBe('c1');
    expect(ack.ok).toBe(true);
    expect(typeof ack.appliedAt).toBe('string');
    expect(ISO_RE.test(ack.appliedAt)).toBe(true);
  });

  it('includes error and code when provided', () => {
    const ack = buildCommandAck({
      deviceId: 'tv-1',
      commandId: 'c1',
      ok: false,
      error: 'bad thing',
      code: 'DEVICE_BUSY',
    });
    expect(ack.error).toBe('bad thing');
    expect(ack.code).toBe('DEVICE_BUSY');
    expect(ack.ok).toBe(false);
  });

  it('passes through provided appliedAt', () => {
    const t = '2026-01-01T00:00:00.000Z';
    const ack = buildCommandAck({
      deviceId: 'tv-1', commandId: 'c1', ok: true, appliedAt: t,
    });
    expect(ack.appliedAt).toBe(t);
  });

  it('validates a correct ack', () => {
    const ack = buildCommandAck({ deviceId: 'tv-1', commandId: 'c1', ok: true });
    expect(validateCommandAck(ack).valid).toBe(true);
  });

  it('rejects an ack missing deviceId', () => {
    const ack = buildCommandAck({ deviceId: 'tv-1', commandId: 'c1', ok: true });
    delete ack.deviceId;
    expect(validateCommandAck(ack).valid).toBe(false);
  });

  it('rejects an ack missing commandId', () => {
    const ack = buildCommandAck({ deviceId: 'tv-1', commandId: 'c1', ok: true });
    delete ack.commandId;
    expect(validateCommandAck(ack).valid).toBe(false);
  });

  it('rejects an ack missing ok', () => {
    const ack = buildCommandAck({ deviceId: 'tv-1', commandId: 'c1', ok: true });
    delete ack.ok;
    expect(validateCommandAck(ack).valid).toBe(false);
  });

  it('rejects an ack with non-boolean ok', () => {
    const ack = buildCommandAck({ deviceId: 'tv-1', commandId: 'c1', ok: true });
    ack.ok = 'yes';
    expect(validateCommandAck(ack).valid).toBe(false);
  });
});

describe('buildDeviceStateBroadcast / validateDeviceStateBroadcast', () => {
  it('builds a valid broadcast', () => {
    const b = buildDeviceStateBroadcast({
      deviceId: 'tv-1',
      snapshot: makeSnapshot(),
      reason: 'change',
    });
    expect(b.topic).toBe('device-state');
    expect(b.deviceId).toBe('tv-1');
    expect(b.reason).toBe('change');
    expect(b.snapshot).toBeTruthy();
    expect(typeof b.ts).toBe('string');
    expect(ISO_RE.test(b.ts)).toBe(true);
  });

  it('passes through provided ts', () => {
    const t = '2026-02-02T00:00:00.000Z';
    const b = buildDeviceStateBroadcast({
      deviceId: 'tv-1', snapshot: makeSnapshot(), reason: 'heartbeat', ts: t,
    });
    expect(b.ts).toBe(t);
  });

  it('validates a correct broadcast', () => {
    const b = buildDeviceStateBroadcast({
      deviceId: 'tv-1', snapshot: makeSnapshot(), reason: 'initial',
    });
    expect(validateDeviceStateBroadcast(b).valid).toBe(true);
  });

  it('rejects a broadcast with unknown reason', () => {
    const b = buildDeviceStateBroadcast({
      deviceId: 'tv-1', snapshot: makeSnapshot(), reason: 'change',
    });
    b.reason = 'bogus';
    expect(validateDeviceStateBroadcast(b).valid).toBe(false);
  });

  it('rejects a broadcast missing deviceId', () => {
    const b = buildDeviceStateBroadcast({
      deviceId: 'tv-1', snapshot: makeSnapshot(), reason: 'change',
    });
    delete b.deviceId;
    expect(validateDeviceStateBroadcast(b).valid).toBe(false);
  });

  it('rejects a broadcast with an invalid snapshot', () => {
    const snap = makeSnapshot();
    snap.state = 'DANCING';
    const b = buildDeviceStateBroadcast({
      deviceId: 'tv-1', snapshot: snap, reason: 'change',
    });
    expect(validateDeviceStateBroadcast(b).valid).toBe(false);
  });
});

describe('buildPlaybackStateBroadcast', () => {
  it('builds a valid broadcast', () => {
    const b = buildPlaybackStateBroadcast({
      clientId: 'client-1',
      sessionId: 's1',
      displayName: 'Kitchen',
      state: 'playing',
      currentItem: { contentId: 'plex:1', format: 'video', title: 'X' },
      position: 0,
      duration: 60,
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    });
    expect(b.topic).toBe('playback_state');
    expect(b.clientId).toBe('client-1');
    expect(b.sessionId).toBe('s1');
    expect(b.displayName).toBe('Kitchen');
    expect(b.state).toBe('playing');
    expect(b.currentItem).toBeTruthy();
    expect(b.position).toBe(0);
    expect(b.duration).toBe(60);
    expect(typeof b.ts).toBe('string');
    expect(ISO_RE.test(b.ts)).toBe(true);
  });

  it('accepts null currentItem', () => {
    const b = buildPlaybackStateBroadcast({
      clientId: 'c1', sessionId: 's1', displayName: 'N', state: 'idle',
      currentItem: null, position: 0, duration: 0,
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    });
    expect(b.currentItem).toBeNull();
  });

  it('passes through provided ts', () => {
    const t = '2026-03-03T00:00:00.000Z';
    const b = buildPlaybackStateBroadcast({
      clientId: 'c1', sessionId: 's1', displayName: 'N', state: 'idle',
      currentItem: null, position: 0, duration: 0,
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
      ts: t,
    });
    expect(b.ts).toBe(t);
  });

  it('throws on invalid state', () => {
    expect(() => buildPlaybackStateBroadcast({
      clientId: 'c1', sessionId: 's1', displayName: 'N', state: 'DANCING',
      currentItem: null, position: 0, duration: 0,
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
    })).toThrow(TypeError);
  });
});
