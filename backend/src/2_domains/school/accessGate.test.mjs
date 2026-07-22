/**
 * Presence gate tests.
 *
 * Nearly all of these are about the FAILURE direction, because that is the
 * whole design: this is a lock on a panel a child cannot repair, in a house
 * whose Bluetooth is documented-flaky. Getting "cannot confirm" wrong in one
 * direction bricks the panel and in the other silently disables the control.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveGate, gateMessage, capabilitiesUnder, allowsTrackedWork,
  ROLE_SEVERITY, DEFAULT_TTL_MS,
} from './accessGate.mjs';

const NOW = Date.parse('2026-07-22T09:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const HEADSET = { mac: 'AA:BB:CC:DD:EE:FF', role: 'headset' };
const KEYBOARD = { mac: '11:22:33:44:55:66', role: 'keyboard' };
const REQUIRED = [HEADSET, KEYBOARD];

const presence = (devices, ageMs = 1000) => ({ at: ago(ageMs), devices });
const dev = (d, connected) => ({ mac: d.mac, role: d.role, connected });

describe('when everything is present', () => {
  it('opens', () => {
    const gate = resolveGate({
      presence: presence([dev(HEADSET, true), dev(KEYBOARD, true)]),
      now: NOW, required: REQUIRED,
    });
    expect(gate).toMatchObject({ level: 'open', stale: false, missing: [] });
    expect(allowsTrackedWork(gate)).toBe(true);
    expect(gateMessage(gate)).toBeNull();
  });

  it('matches MACs case-insensitively', () => {
    const gate = resolveGate({
      presence: presence([{ mac: 'aa:bb:cc:dd:ee:ff', connected: true }, dev(KEYBOARD, true)]),
      now: NOW, required: REQUIRED,
    });
    expect(gate.level).toBe('open');
  });
});

describe('severity by role', () => {
  it('disables when the headset is gone — audio IS the app', () => {
    const gate = resolveGate({
      presence: presence([dev(HEADSET, false), dev(KEYBOARD, true)]),
      now: NOW, required: REQUIRED,
    });
    expect(gate.level).toBe('disabled');
    expect(gateMessage(gate)).toMatch(/connect the headset/i);
  });

  it('only hinders when the keyboard is gone', () => {
    const gate = resolveGate({
      presence: presence([dev(HEADSET, true), dev(KEYBOARD, false)]),
      now: NOW, required: REQUIRED,
    });
    expect(gate.level).toBe('hindered');
    expect(allowsTrackedWork(gate)).toBe(false);
  });

  it('takes the WORST severity when several are missing', () => {
    const gate = resolveGate({
      presence: presence([dev(HEADSET, false), dev(KEYBOARD, false)]),
      now: NOW, required: REQUIRED,
    });
    expect(gate.level).toBe('disabled');
    expect(gate.missing.sort()).toEqual(['headset', 'keyboard']);
  });

  it('has a severity for every role it claims to gate', () => {
    for (const role of Object.keys(ROLE_SEVERITY)) {
      expect(['hindered', 'disabled']).toContain(ROLE_SEVERITY[role]);
    }
  });
});

describe('cannot confirm — the direction that matters', () => {
  it('HINDERS on a stale report, never opens', () => {
    // Killing the APK must not unlock anything.
    const gate = resolveGate({
      presence: presence([dev(HEADSET, true), dev(KEYBOARD, true)], DEFAULT_TTL_MS + 1000),
      now: NOW, required: REQUIRED,
    });
    expect(gate).toMatchObject({ level: 'hindered', stale: true, reason: 'presence-stale' });
    expect(allowsTrackedWork(gate)).toBe(false);
  });

  it('HINDERS when there has never been a report, never disables', () => {
    // A crash or a WiFi blip must not leave a child at a dead panel.
    const gate = resolveGate({ presence: null, now: NOW, required: REQUIRED });
    expect(gate).toMatchObject({ level: 'hindered', stale: true, reason: 'presence-unknown' });
  });

  it('says it is waiting rather than blaming a device', () => {
    const gate = resolveGate({ presence: null, now: NOW, required: REQUIRED });
    expect(gateMessage(gate)).toMatch(/checking in|check in/i);
  });

  it('treats a malformed timestamp as stale', () => {
    const gate = resolveGate({
      presence: { at: 'nonsense', devices: [dev(HEADSET, true)] },
      now: NOW, required: REQUIRED,
    });
    expect(gate.stale).toBe(true);
  });

  it('obeys a report right up to the TTL boundary', () => {
    const gate = resolveGate({
      presence: presence([dev(HEADSET, true), dev(KEYBOARD, true)], DEFAULT_TTL_MS - 1),
      now: NOW, required: REQUIRED,
    });
    expect(gate.level).toBe('open');
  });
});

describe('configuration safety', () => {
  it('is OPEN when no gate is configured — opting out must not lock anyone out', () => {
    const gate = resolveGate({ presence: null, now: NOW, required: [] });
    expect(gate).toMatchObject({ level: 'open', reason: 'no-gate-configured' });
    expect(allowsTrackedWork(gate)).toBe(true);
  });

  it('ignores a role it does not recognise rather than failing closed', () => {
    // Bricking the panel over a spelling mistake in config would be worse than
    // the typo itself.
    const gate = resolveGate({
      presence: presence([{ mac: 'ZZ', role: 'tuba', connected: false }]),
      now: NOW, required: [{ mac: 'ZZ', role: 'tuba' }],
    });
    expect(gate.level).toBe('open');
  });

  it('ignores a requirement with no MAC', () => {
    const gate = resolveGate({
      presence: presence([]), now: NOW, required: [{ role: 'headset' }],
    });
    expect(gate.level).toBe('open');
  });
});

describe('capabilitiesUnder', () => {
  const claimed = { microphone: true, textInput: ['EN', 'KR'] };

  it('passes claims through when open', () => {
    const gate = resolveGate({ presence: presence([dev(HEADSET, true), dev(KEYBOARD, true)]), now: NOW, required: REQUIRED });
    expect(capabilitiesUnder(gate, claimed)).toEqual(claimed);
  });

  it('removes text input when hindered, whatever the client claims', () => {
    // The client's declaration is a guess; a missing keyboard at a known MAC
    // is a fact.
    const gate = resolveGate({ presence: presence([dev(HEADSET, true), dev(KEYBOARD, false)]), now: NOW, required: REQUIRED });
    expect(capabilitiesUnder(gate, claimed)).toEqual({ microphone: true, textInput: [] });
  });

  it('removes everything when disabled', () => {
    const gate = resolveGate({ presence: presence([dev(HEADSET, false)]), now: NOW, required: REQUIRED });
    expect(capabilitiesUnder(gate, claimed)).toEqual({ microphone: false, textInput: [] });
  });
});
