// Fixtures for every fitness-overlay scene. No real household names: riders are
// "Rider A..C" with rider_* ids (public repo; see the PII rule for fixtures).
import React from 'react';
import VoiceMemoOverlay from '../../../__app_modules/wellness/fitness/browser/player/overlays/VoiceMemoOverlay.jsx';
import PlaybackBudgetNotice from '../../../__app_modules/wellness/fitness/browser/player/overlays/PlaybackBudgetNotice.jsx';
import GovernanceStateOverlay from '../../../__app_modules/wellness/fitness/browser/player/overlays/GovernanceStateOverlay.jsx';
import { resolveGovernanceDisplay } from '../../../__app_modules/wellness/fitness/browser/hooks/useGovernanceDisplay.js';
// The overlay's own '../../context/FitnessContext.jsx' import is aliased to this stub.
import { FitnessContext } from './stubs/FitnessContext.jsx';

const noop = () => {};
const AV = (id) => `/api/v1/static/img/users/${id}`;

// ── voice memo ──────────────────────────────────────────────────────────────
const LONG_TRANSCRIPT = 'This was another workout from the INSANITY franchise. This one was less about '
  + 'running around, jumping, jumping jacks, and brought in more dumbbell work. The heart rate wasn\'t as '
  + 'high or as redlining as INSANITY workouts typically are, but this one definitely had a muscle '
  + 'endurance component. I started with 20-pound dumbbells on the first set, but dropped to 15s starting '
  + 'at the second set, and that was probably the right call because my form was falling apart by the '
  + 'end of the curls. The shoulder presses were the hardest part, especially the slow negatives in the '
  + 'third round. My left knee felt a little tight during the lunges, so I kept those shallow and skipped '
  + 'the jumping version. Next time I want to stay with the 20s through the second set and take a longer '
  + 'water break before the core section. Overall a solid session, and I would do this one again next week.';
const SHORT_TRANSCRIPT = 'Good workout today, legs felt strong and the intervals went well.';

// The overlay reads pause/resume from the fitness context; the recorder hook
// reads the same context. Neither is exercised in review mode.
const FITNESS_CTX = { pauseMusicPlayer: noop, resumeMusicPlayer: noop };

const memoScene = (transcript) => () => {
  const memo = { memoId: 'memo-1', transcriptClean: transcript, transcriptRaw: transcript,
    createdAt: Date.now() - 5000, sessionElapsedSeconds: 1845, videoTimeSeconds: 1610 };
  return (
    <FitnessContext.Provider value={FITNESS_CTX}>
      <VoiceMemoOverlay
        // autoAccept off: the countdown bar would make the shot time-dependent.
        overlayState={{ open: true, mode: 'review', memoId: 'memo-1', autoAccept: false, startedAt: Date.now() }}
        voiceMemos={[memo]}
        onClose={noop} onOpenReview={noop} onOpenList={noop} onOpenRedo={noop}
        onRemoveMemo={noop} onAddMemo={noop} onReplaceMemo={noop}
        sessionId="session-fixture"
        playerRef={{ current: null }}
      />
    </FitnessContext.Provider>
  );
};

// ── playback budget ─────────────────────────────────────────────────────────
const budgetScene = (status) => () => <PlaybackBudgetNotice status={status} onUnlock={noop} onBack={noop} />;

// ── governance lock ─────────────────────────────────────────────────────────
const ZONE_IDS = ['cool', 'active', 'warm', 'hot', 'fire'];
const ZONE_COLORS = ['#94a3b8', '#22c55e', '#eab308', '#f97316', '#ef4444'];
const ZONE_META = { map: Object.fromEntries(ZONE_IDS.map((id, rank) => [id, { id, name: id[0].toUpperCase() + id.slice(1), rank, color: ZONE_COLORS[rank] }])) };
const ZONE_SEQUENCE = [
  { id: 'cool', name: 'Cool', threshold: 60, color: ZONE_COLORS[0] },
  { id: 'active', name: 'Active', threshold: 110, color: ZONE_COLORS[1] },
  { id: 'warm', name: 'Warm', threshold: 130, color: ZONE_COLORS[2] },
  { id: 'hot', name: 'Hot', threshold: 150, color: ZONE_COLORS[3] },
  { id: 'fire', name: 'Fire', threshold: 170, color: ZONE_COLORS[4] },
];
const rider = (id, name, heartRate, zoneId) => [id, {
  displayName: name, avatarSrc: AV(id), heartRate, zoneId, zoneTrusted: heartRate != null,
  zoneSequence: heartRate != null ? ZONE_SEQUENCE : [],
}];
const floor = (zone, requiredCount, missingUsers) => ({
  id: `${zone}-floor`, type: 'zone', zone, zoneLabel: ZONE_META.map[zone].name,
  requiredCount, actualCount: 0, satisfied: false, missingUsers, metUsers: [],
});
const lockScene = (riders, requirements) => () => {
  const display = resolveGovernanceDisplay({
    isGoverned: true, status: 'locked', videoLocked: true,
    activeUserCount: riders.length, requirements,
    deadline: null, gracePeriodTotal: 30,
  }, new Map(riders), ZONE_META);
  return <GovernanceStateOverlay display={display} onUnlock={noop} />;
};

export const SCENES = {
  'memo-long': { render: memoScene(LONG_TRANSCRIPT) },
  'memo-short': { render: memoScene(SHORT_TRANSCRIPT) },
  'budget-checking': { render: budgetScene('checking') },
  'budget-unavailable': { render: budgetScene('unavailable') },
  'budget-exhausted': { render: budgetScene('exhausted') },
  // One rule: Rider A at 85 BPM in Cool must reach Hot (1 required); Rider B is
  // in the session with no heart rate.
  'lock-one-rule': { render: lockScene(
    [rider('rider_a', 'Rider A', 85, 'cool'), rider('rider_b', 'Rider B', null, null)],
    [floor('hot', 1, ['rider_a', 'rider_b'])],
  ) },
  // Two rules: Rider C 105 and Rider A 91, both Cool; Hot (1 required) and Active (2 required).
  'lock-two-rules': { render: lockScene(
    [rider('rider_c', 'Rider C', 105, 'cool'), rider('rider_a', 'Rider A', 91, 'cool')],
    [floor('hot', 1, ['rider_c', 'rider_a']), floor('active', 2, ['rider_c', 'rider_a'])],
  ) },
};
