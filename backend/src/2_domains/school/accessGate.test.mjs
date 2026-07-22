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
  resolveGate, gateMessage, capabilitiesUnder, allowsTrackedWork, allowsRung,
  ROLE_SEVERITY, DEFAULT_TTL_MS,
} from './accessGate.mjs';

const NOW = Date.parse('2026-07-22T09:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const HEADSET = { mac: 'AA:BB:CC:DD:EE:FF', role: 'headset' };
const KEYBOARD = { mac: '11:22:33:44:55:66', role: 'keyboard' };
const REQUIRED = [HEADSET, KEYBOARD];

// Freshness is judged on `receivedAt`, stamped by the backend on arrival —
// never on the client's `at`, which a wrong or hostile clock controls.
const presence = (devices, ageMs = 1000) => ({
  receivedAt: NOW - ageMs, at: ago(ageMs), devices,
});
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
    // Hindered still records work — see "what a hindered gate still permits".
    // This assertion used to demand `false`, which is precisely how the broken
    // semantics got locked in by a test that agreed with the bug.
    expect(allowsTrackedWork(gate)).toBe(true);
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

  it('treats a report with no arrival stamp as stale', () => {
    const gate = resolveGate({
      presence: { at: 'nonsense', devices: [dev(HEADSET, true)] },
      now: NOW, required: REQUIRED,
    });
    expect(gate.stale).toBe(true);
  });

  it('IGNORES a client timestamp far in the future', () => {
    // Trusting the client's `at` made one forged POST hold the gate open for
    // years. Only the backend's arrival stamp counts.
    const gate = resolveGate({
      presence: {
        receivedAt: NOW - (DEFAULT_TTL_MS + 60000),
        at: new Date(NOW + 10 * 365 * 86400000).toISOString(),
        devices: [dev(HEADSET, true), dev(KEYBOARD, true)],
      },
      now: NOW, required: REQUIRED,
    });
    expect(gate.stale).toBe(true);
    expect(gate.level).toBe('hindered');
  });

  it('is unaffected by a panel whose clock runs slow', () => {
    // Otherwise every report is born stale and the gate sticks at hindered
    // with every device connected — an undiagnosable pit.
    const gate = resolveGate({
      presence: {
        receivedAt: NOW - 1000,
        at: new Date(NOW - 86400000).toISOString(),
        devices: [dev(HEADSET, true), dev(KEYBOARD, true)],
      },
      now: NOW, required: REQUIRED,
    });
    expect(gate.level).toBe('open');
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

describe('what a hindered gate still permits', () => {
  const claimed = { microphone: true, textInput: ['EN', 'KR'] };
  const hindered = resolveGate({
    presence: presence([dev(HEADSET, true), dev(KEYBOARD, false)]), now: NOW, required: REQUIRED,
  });
  const noReq = null;
  const needsMic = { kind: 'microphone' };
  const needsHangul = { kind: 'textInput', language: 'KR' };

  it('still records the rungs the queue is offering', () => {
    // The bug this replaces: the queue showed a repetition drill under a
    // hindered gate and the recorder then refused it with "connect the
    // keyboard" — for a rung that needs no keyboard.
    expect(allowsRung(hindered, noReq, claimed)).toBe(true);
    expect(allowsRung(hindered, needsMic, claimed)).toBe(true);
  });

  it('refuses only the rung whose device is actually missing', () => {
    expect(allowsRung(hindered, needsHangul, claimed)).toBe(false);
  });

  it('refuses everything when disabled or stale', () => {
    const disabled = resolveGate({ presence: presence([dev(HEADSET, false)]), now: NOW, required: REQUIRED });
    const stale = resolveGate({ presence: null, now: NOW, required: REQUIRED });
    for (const gate of [disabled, stale]) {
      expect(allowsRung(gate, noReq, claimed)).toBe(false);
      expect(allowsTrackedWork(gate)).toBe(false);
    }
  });

  it('allows tracked work while merely hindered', () => {
    expect(allowsTrackedWork(hindered)).toBe(true);
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
