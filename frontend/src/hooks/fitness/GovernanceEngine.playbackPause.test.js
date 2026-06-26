// Issue 4 — when the video is paused (voice memo open or a manual pause that is
// NOT governance's own lock), governance must FREEZE and resume exactly where it
// left off: the grace countdown stops, no new lock/challenge transitions happen,
// and on resume the remaining grace is preserved (not restarted, not expired).
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from './GovernanceEngine.js';

function buildSession() {
  return {
    _deviceRouter: { getEquipmentCatalog: () => [] },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    // Pulse-driven evaluate() reads this — felix is below the 'warm' base-req.
    getActiveParticipantState: () => ({
      participants: ['felix'],
      zoneMap: { felix: 'active' },
      totalCount: 1
    })
  };
}

const POLICY = {
  governed_labels: ['cardio'],
  grace_period_seconds: 30,
  policies: {
    default: { name: 'Default', base_requirement: [{ warm: 'all' }], challenges: [] }
  }
};

const ZONE_MAPS = {
  zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
  zoneInfoMap: { active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' } },
  totalCount: 1
};
const EVAL_MET = { activeParticipants: ['felix'], userZoneMap: { felix: 'warm' }, ...ZONE_MAPS };
const EVAL_UNMET = { activeParticipants: ['felix'], userZoneMap: { felix: 'active' }, ...ZONE_MAPS };

function makeEngine() {
  let clock = 100000;
  const engine = new GovernanceEngine(buildSession(), { now: () => clock });
  engine.configure(POLICY);
  engine.setMedia({ id: 'v1', type: 'episode', labels: ['cardio'] });
  return { engine, advance: (d) => { clock += d; return clock; }, now: () => clock };
}

// Drive into the warning (grace) phase: satisfy once, then drop below.
function intoWarning(h) {
  h.advance(200);
  h.engine.evaluate(EVAL_MET);   // unlocked, satisfiedOnce = true
  h.engine.evaluate(EVAL_UNMET); // base-req now unmet -> warning + grace deadline
  return h;
}

describe('GovernanceEngine — freeze on playback pause (issue 4)', () => {
  it('enters warning with a grace deadline once base-req drops after being met', () => {
    const h = intoWarning(makeEngine());
    expect(h.engine.phase).toBe('warning');
    expect(Number.isFinite(h.engine.meta.deadline)).toBe(true);
  });

  it('does not advance to locked while paused, even past the original deadline', () => {
    const h = intoWarning(makeEngine());
    const deadlineBefore = h.engine.meta.deadline;
    h.engine.setPlaybackPaused(true);
    h.advance(60000); // well past the 30s grace
    h.engine.evaluate(EVAL_UNMET);
    expect(h.engine.phase).toBe('warning');         // frozen — not locked
    expect(h.engine.meta.deadline).toBe(deadlineBefore); // deadline not advanced while paused
  });

  it('resumes where it froze: shifts the deadline by the paused span, then locks after the remaining grace', () => {
    const h = intoWarning(makeEngine());
    const deadline0 = h.engine.meta.deadline; // = 100200 + 30000
    h.advance(5000); // 5s into the grace
    h.engine.setPlaybackPaused(true);
    h.advance(60000); // long pause
    h.engine.evaluate(EVAL_UNMET);
    expect(h.engine.phase).toBe('warning');
    h.engine.setPlaybackPaused(false);
    expect(h.engine.meta.deadline).toBe(deadline0 + 60000); // shifted forward by the pause
    // ~25s grace remained (30 - 5). Just under -> still warning; just over -> locked.
    h.advance(24000); h.engine.evaluate(EVAL_UNMET);
    expect(h.engine.phase).toBe('warning');
    h.advance(2000); h.engine.evaluate(EVAL_UNMET);
    expect(h.engine.phase).toBe('locked');
  });

  it('re-evaluates immediately on resume (clears warning if base-req is met again)', () => {
    const h = intoWarning(makeEngine());
    h.engine.setPlaybackPaused(true);
    h.advance(1000);
    // While paused the engine is frozen; on resume it re-pulses. Feed a satisfied
    // snapshot first so the resume pulse (which reads latest inputs) sees 'met'.
    h.engine.evaluate(EVAL_MET); // frozen no-op, but captures nothing while paused
    h.engine.setPlaybackPaused(false);
    h.engine.evaluate(EVAL_MET);
    expect(h.engine.phase).toBe('unlocked');
  });
});
