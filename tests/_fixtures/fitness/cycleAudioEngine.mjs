import { GovernanceEngine } from '../../../__app_modules/wellness/fitness/browser/hooks/fitness/GovernanceEngine.js';

// Real producer fixture: direct clock/evaluate driving replaces scheduled ticks,
// while policy selection, cadence filtering, recovery and state composition stay live.
export function createCycleAudioEngine() {
  let now = 100000;
  const session = {
    _deviceRouter: { getEquipmentCatalog: () => [{ id: 'cycle_ace', eligible_users: ['rider'] }] },
    getParticipantProfile: () => null,
    zoneProfileStore: null,
    getActiveParticipantState: () => ({ participants: ['rider'], zoneMap: { rider: 'active' }, totalCount: 1 }),
  };
  const engine = new GovernanceEngine(session, { now: () => now, random: () => 0.5 });
  engine._schedulePulse = () => {};
  engine.configure({
    governed_labels: ['cardio'], grace_period_seconds: 1,
    audio_cues: [
      { id: 'cycle_start', trigger: 'cycle_start', sound: 'start.mp3', duck_to: 0.2 },
      { id: 'cycle_end', trigger: 'cycle_end', sound: 'end.mp3', duck_to: 0.2 },
      { id: 'cycle_fail', trigger: 'cycle_fail', sound: 'fail.mp3', duck_to: 0.2 },
      { id: 'cycle_hurry', trigger: 'cycle_hurry', sound: 'hurry.mp3', duck_to: 0.1 },
      { id: 'hr_warning', trigger: 'governance_warning', sound: 'warning.mp3', duck_to: 0.15 },
    ],
    policies: { default: { base_requirement: [{ active: 'all' }], challenges: [{
      interval: [999, 999], selections: [{ type: 'cycle', equipment: 'cycle_ace',
        hi_rpm_range: [80, 80], lo_rpm_ratio: 0.75, segment_count: [1, 1],
        segment_duration_seconds: [60, 60], ramp_seconds: [5, 5],
        init: { min_rpm: 30, time_allowed_seconds: 10 }, time_allowed: 999,
      }],
    }] } },
  });
  engine.setMedia({ id: 'video-1', type: 'episode', labels: ['cardio'] });
  const tick = (delta = 0, rpm = 80, zone = 'active') => {
    now += delta;
    engine.evaluate({ activeParticipants: ['rider'], userZoneMap: { rider: zone }, totalCount: 1,
      zoneRankMap: { cool: 0, active: 1 }, zoneInfoMap: { active: { id: 'active', name: 'Active' } },
      equipmentCadenceMap: rpm === null ? {} : { cycle_ace: { connected: true, rpm, ts: now } },
    });
    return engine.state;
  };
  tick(); // Establish policy/base HR before creating the manual challenge.
  const start = (rpm = 80) => {
    const result = engine.triggerChallenge({ type: 'cycle', selectionId: 'default_0_0', riderId: 'rider' });
    if (!result?.success) throw new Error(`Cannot start cycle fixture: ${result?.reason}`);
    return tick(0, rpm);
  };
  return { engine, tick, start };
}
