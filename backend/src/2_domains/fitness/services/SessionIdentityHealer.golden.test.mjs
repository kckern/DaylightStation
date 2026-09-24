/**
 * Golden-parity fixture test — real session 20260627195941 (2026-06-27,
 * Jane Fonda "Complete Workout"), trimmed to the 3 human occupants sharing
 * HR-strap device 10001: grannie (primary, full continuous trace, 966
 * rings), learner1 (2 HR samples then dropped strap), parent-two (1 HR sample
 * then dropped strap — a late re-tag onto the same physical strap grannie
 * wore the rest of the session).
 *
 * This is the motivating real-world case for the identity-reconciliation
 * heal: learner1 and parent-two are near-zero-effort "ghost" occupants that
 * should be folded into grannie, who did the actual workout. The companion
 * frontend test (`frontend/src/hooks/fitness/sessionBackfill.golden.test.js`)
 * asserts the SAME outcome from `runSessionBackfill` on the in-memory form of
 * the identical data — this pair is the golden-parity check between the two
 * independently-implemented reconciliation engines.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import { describe, it, expect } from 'vitest';
import { planHeal } from './SessionIdentityHealer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '__fixtures__', 'session-20260627195941.yml');

function loadFixture() {
  const fixture = yaml.load(readFileSync(fixturePath, 'utf8'));
  fixture.timeline.series = Object.fromEntries(Object.entries(fixture.timeline.series)
    .map(([key, value]) => [key, typeof value === 'string' ? JSON.parse(value) : value]));
  return fixture;
}

describe('SessionIdentityHealer golden parity — session 20260627195941', () => {
  it('removes the two ghost occupants (parent-two, learner1) and keeps grannie', () => {
    const sessionObj = loadFixture();
    const plan = planHeal(sessionObj);

    expect([...plan.removedOccupants].sort()).toEqual(['learner1', 'parent-two']);
    expect(plan.removedOccupants).not.toContain('grannie');
    expect(plan.needsHeal).toBe(true);
  });
});

describe('SessionIdentityHealer — 2026-09-23 split (session 20260923183528, scrubbed)', () => {
  const load = () => yaml.load(readFileSync(path.join(__dirname, '__fixtures__', 'session-20260923183528.yml'), 'utf8'));

  it('plans the split repair back to kid-a and removes the empty kid-d / kid-e', () => {
    const plan = planHeal(load());
    expect(plan.needsHeal).toBe(true);
    expect(plan.splitRepairs.map((r) => [r.metric, r.from, r.to])).toEqual(
      expect.arrayContaining([['rings', 'kid-b', 'kid-a'], ['beats', 'kid-b', 'kid-a']]));
    expect(plan.removedOccupants).toEqual(expect.arrayContaining(['kid-d', 'kid-e']));
    expect(plan.removedOccupants).not.toContain('kid-a');
    expect(plan.removedOccupants).not.toContain('kid-b');
    expect(plan.removedOccupants).not.toContain('guest-c');
  });

  it('honours relabelled stints — the effort rule never re-judges a correction', () => {
    const obj = {
      timeline: {
        interval_seconds: 5,
        series: {
          'kid-a:hr': '[null,95,null,null]', 'kid-a:rings': '[0,0,0,0]',
          'kid-z:hr': '[null,null,140,140]', 'kid-z:rings': '[0,0,2,4]',
        },
      },
      entities: [
        { entityId: 'e1', profileId: 'kid-a', deviceId: 'D2', startTime: 1000, endTime: 2000, status: 'superseded', relabeledFrom: ['kid-b'] },
        { entityId: 'e2', profileId: 'kid-z', deviceId: 'D2', startTime: 2000, endTime: null, status: 'active' },
      ],
    };
    const plan = planHeal(obj);
    expect(plan.transfers.find((t) => t.from === 'kid-a')).toBeUndefined();
    expect(plan.removedOccupants).not.toContain('kid-a');
    expect(plan.removedOccupants).toContain('kid-b');
  });
});

describe('SessionIdentityHealer — reads the on-disk form', () => {
  it('parses RLE JSON-string series (as stored) before judging effort', () => {
    // Two real riders taking turns on one strap, series exactly as stored on
    // disk (JSON strings). Read as strings, both look effortless and one gets
    // folded into the other.
    const stored = {
      timeline: {
        interval_seconds: 5,
        series: {
          'rider-a:hr': '[[140,20],[null,20]]', 'rider-a:zone': '[["w",20],[null,20]]', 'rider-a:rings': '[[0,1],[40,19],[40,20]]',
          'rider-b:hr': '[[null,20],[140,20]]', 'rider-b:zone': '[[null,20],["w",20]]', 'rider-b:rings': '[[0,21],[38,19]]',
        },
      },
      entities: [
        { entityId: 'e1', profileId: 'rider-a', deviceId: 'D1', startTime: 1000, endTime: 100000, status: 'superseded' },
        { entityId: 'e2', profileId: 'rider-b', deviceId: 'D1', startTime: 100000, endTime: null, status: 'active' },
      ],
    };
    const plan = planHeal(stored);
    expect(plan.removedOccupants).toEqual([]);
    expect(plan.transfers).toEqual([]);
  });
});
