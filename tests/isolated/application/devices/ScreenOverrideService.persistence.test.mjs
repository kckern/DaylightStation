import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScreenOverrideService } from '#apps/devices/services/ScreenOverrideService.mjs';
import { createPianoScreenHoldStore } from '#adapters/devices/PianoScreenHoldStore.mjs';

const MIN = 60_000;
const DAY = 86_400_000;

function makeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('ScreenOverrideService persistence over PianoScreenHoldStore', () => {
  let dir; let file; let clock;
  const boot = (deviceId = 'piano') =>
    new ScreenOverrideService({ clock, store: createPianoScreenHoldStore(deviceId, file) });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-hold-'));
    file = path.join(dir, 'piano', 'screen-hold.json');
    clock = makeClock();
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('an unexpired hold survives a restart with its original deadline', () => {
    const before = boot();
    const entry = before.set('piano', 'off', 30);
    clock.advance(10 * MIN);
    const after = boot();
    expect(after.get('piano')).toEqual({ state: 'off', until: entry.until });
    expect(after.hasDecision('piano')).toBe(true);
  });

  it('an expired hold is dropped on restart but is still recorded as a decision', () => {
    boot().set('piano', 'on', 5);
    clock.advance(5 * MIN);
    const after = boot();
    expect(after.get('piano')).toBeNull();
    expect(after.hasDecision('piano')).toBe(true);
  });

  it('a cleared hold stays cleared after restart', () => {
    const before = boot();
    before.set('piano', 'off', 30);
    before.clear('piano');
    const after = boot();
    expect(after.get('piano')).toBeNull();
    expect(after.hasDecision('piano')).toBe(true);
  });

  it('refuses a persisted deadline more than 24h out', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ deviceId: 'piano', state: 'off', until: clock.now() + DAY + 60_000 }));
    expect(boot().get('piano')).toBeNull();
  });

  it('adopts a deadline right at the 24h limit', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const until = clock.now() + DAY;
    fs.writeFileSync(file, JSON.stringify({ deviceId: 'piano', state: 'on', until }));
    expect(boot().get('piano')).toEqual({ state: 'on', until });
  });

  it('ignores a file saved for a different device', () => {
    boot('other').set('other', 'off', 30);
    const after = boot('piano');
    expect(after.get('piano')).toBeNull();
    expect(after.hasDecision('piano')).toBe(false);
  });

  it('only persists the store device, not others', () => {
    const svc = boot('piano');
    svc.set('kitchen', 'off', 30);
    expect(fs.existsSync(file)).toBe(false);
    expect(boot().get('piano')).toBeNull();
  });

  it('starts empty when there is no file', () => {
    const svc = boot();
    expect(svc.get('piano')).toBeNull();
    expect(svc.hasDecision('piano')).toBe(false);
  });
});
