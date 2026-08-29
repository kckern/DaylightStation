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
