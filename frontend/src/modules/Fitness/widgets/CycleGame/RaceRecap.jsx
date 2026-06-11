import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CycleRaceScreen from './CycleRaceScreen.jsx';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import { LINE_COLORS } from '@/modules/Fitness/lib/cycleGame/lineColors.js';
import resolveParticipantIdentity from '@/modules/Fitness/lib/cycleGame/participantIdentity.js';
import { windowedSeriesKmh } from '@/modules/Fitness/lib/cycleGame/speed.js';
import getLogger from '@/lib/logging/Logger.js';
import './RaceRecap.scss';

let _recapLog;
function recapLog() {
  if (!_recapLog) _recapLog = getLogger().child({ component: 'cycle-game-recap' });
  return _recapLog;
}

const REPLAY_TARGET_MS = 12000; // whole race replays in ~12s regardless of length

/**
 * Full-screen recap of a saved race. Decodes each participant's recorded series
 * and replays the chart by feeding synthesized frames to CycleRaceScreen.
 */
export default function RaceRecap({ candidate, onClose }) {
  const decoded = useMemo(() => {
    const parts = (candidate?.participants || []).map((p, idx) => {
      // Candidates from the lobby rail arrive with identity already resolved
      // (isGhost/avatarSrc via resolveParticipantIdentity upstream); the resolver
      // is the fallback for callers passing bare persisted records. It handles
      // nested ghost ids (ghost:R2:ghost:R1:user → final segment), so never
      // re-parse the id by hand here.
      const ident = resolveParticipantIdentity(p.id, p.displayName);
      return {
        id: p.id,
        isGhost: p.isGhost ?? ident.isGhost,
        displayName: p.displayName || ident.displayName,
        avatarSrc: p.avatarSrc || ident.avatarSrc,
        maxRpm: Number.isFinite(p.gaugeMaxRpm) ? p.gaugeMaxRpm : null,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        dist: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
        hr: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
        rpm: SessionSerializerV3.decodeSeries(p.rpmSeries) || [],
        finalDistanceM: p.finalDistanceM ?? 0,
        finalTimeS: p.finalTimeS ?? null,
        placement: p.placement ?? null
      };
    });
    const maxLen = Math.max(1, ...parts.map((p) => p.dist.length));
    return { parts, maxLen };
  }, [candidate]);

  const [t, setT] = useState(0); // current tick index (0-based, inclusive)
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef(null);

  const stepMs = Math.max(60, Math.round(REPLAY_TARGET_MS / decoded.maxLen));

  useEffect(() => {
    if (!playing) return undefined;
    intervalRef.current = setInterval(() => {
      setT((prev) => {
        if (prev >= decoded.maxLen - 1) { setPlaying(false); return prev; }
        return prev + 1;
      });
    }, stepMs);
    return () => clearInterval(intervalRef.current);
  }, [playing, stepMs, decoded.maxLen]);

  const intervalS = candidate?.intervalSeconds || 1;
  const sampleAt = (arr, i) => (arr.length ? arr[Math.min(i, arr.length - 1)] : 0);

  const riders = {};
  const riderLive = {};
  decoded.parts.forEach((p) => {
    const distNow = sampleAt(p.dist, t);
    riders[p.id] = {
      userId: p.id,
      displayName: p.displayName,
      equipmentId: null,
      cumulativeDistanceM: distNow,
      distanceSeries: p.dist.slice(0, t + 1),
      finishTimeS: p.finalTimeS,
      isGhost: p.isGhost
    };
    const hr = p.hr.length ? p.hr[Math.min(t, p.hr.length - 1)] : null;
    const rpm = t < p.dist.length && p.rpm.length ? p.rpm[Math.min(t, p.rpm.length - 1)] : 0;
    riderLive[p.id] = {
      rpm: Number.isFinite(rpm) ? Math.round(rpm) : 0,
      // Windowed so the integer-metre series doesn't strobe at replay speed;
      // a rider whose series has ended is parked at the line → 0.
      speedKmh: t < p.dist.length ? windowedSeriesKmh(p.dist, t, intervalS) : 0,
      maxRpm: p.maxRpm ?? undefined,
      avatarSrc: p.avatarSrc,
      heartRate: Number.isFinite(hr) ? hr : null,
      zoneId: null,
      zoneColor: p.color,
      zoneProgress: null,
      multiplier: 1
    };
  });

  return (
    <div className="race-recap" role="dialog" aria-modal="true" data-testid="race-recap">
      <div className="race-recap__head">
        <div className="race-recap__title">Race Recap</div>
        <div className="race-recap__meta">
          {candidate?.day || ''}{candidate?.timeOfDay ? ` · ${candidate.timeOfDay}` : ''}
          {' · '}{candidate?.winCondition === 'time' ? 'Time race' : 'Distance race'}
        </div>
        <button type="button" className="race-recap__close" data-testid="race-recap-close" aria-label="close" onClick={onClose}>×</button>
      </div>

      <div className="race-recap__stage">
        <CycleRaceScreen
          winCondition={candidate?.winCondition || 'distance'}
          goalM={candidate?.goalM ?? 3000}
          timeCapS={candidate?.timeCapS ?? 300}
          elapsedS={t * intervalS}
          riders={riders}
          riderLive={riderLive}
          showSpeedos
        />
      </div>

      <div className="race-recap__controls">
        <button type="button" className="race-recap__btn" data-testid="race-recap-play" onClick={() => {
          if (t >= decoded.maxLen - 1) setT(0);
          setPlaying((p) => {
            recapLog().info('cycle_game.recap_play', { raceId: candidate?.raceId, playing: !p, t });
            return !p;
          });
        }}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range" className="race-recap__scrub" min={0} max={decoded.maxLen - 1} value={t}
          onChange={(e) => {
            setPlaying(false);
            setT(Number(e.target.value));
            recapLog().sampled('cycle_game.recap_scrub', { raceId: candidate?.raceId, t: Number(e.target.value) }, { maxPerMinute: 30, aggregate: true });
          }}
          aria-label="scrub"
        />
      </div>
    </div>
  );
}

RaceRecap.propTypes = {
  candidate: PropTypes.object,
  onClose: PropTypes.func
};
