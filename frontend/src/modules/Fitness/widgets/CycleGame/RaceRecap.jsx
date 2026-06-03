import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import CycleRaceScreen from './CycleRaceScreen.jsx';
import RaceResults from './RaceResults.jsx';
import { SessionSerializerV3 } from '@/hooks/fitness/SessionSerializerV3.js';
import './RaceRecap.scss';

const LINE_COLORS = ['#3ddc84', '#ff9f43', '#a66cff'];
const REPLAY_TARGET_MS = 12000; // whole race replays in ~12s regardless of length

/**
 * Full-screen recap of a saved race. Decodes each participant's recorded series
 * and replays the chart by feeding synthesized frames to CycleRaceScreen.
 */
export default function RaceRecap({ candidate, onClose }) {
  const decoded = useMemo(() => {
    const parts = (candidate?.participants || []).map((p, idx) => ({
      id: p.id,
      displayName: p.displayName || p.id,
      avatarSrc: p.avatarSrc || `/api/v1/static/img/users/${p.id}`,
      color: LINE_COLORS[idx % LINE_COLORS.length],
      dist: SessionSerializerV3.decodeSeries(p.distanceSeries) || [],
      hr: SessionSerializerV3.decodeSeries(p.hrSeries) || [],
      finalDistanceM: p.finalDistanceM ?? 0,
      finalTimeS: p.finalTimeS ?? null,
      placement: p.placement ?? null
    }));
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
    riders[p.id] = {
      userId: p.id,
      displayName: p.displayName,
      equipmentId: null,
      cumulativeDistanceM: sampleAt(p.dist, t),
      distanceSeries: p.dist.slice(0, t + 1),
      finishTimeS: p.finalTimeS,
      isGhost: false
    };
    const hr = p.hr.length ? p.hr[Math.min(t, p.hr.length - 1)] : null;
    riderLive[p.id] = {
      rpm: 0,
      avatarSrc: p.avatarSrc,
      heartRate: Number.isFinite(hr) ? hr : null,
      zoneId: null,
      zoneColor: p.color,
      zoneProgress: null,
      multiplier: 1
    };
  });

  const standings = [...decoded.parts]
    .sort((a, b) => (a.placement || 99) - (b.placement || 99))
    .map((p) => ({ userId: p.id, placement: p.placement, finishTimeS: p.finalTimeS, distanceM: p.finalDistanceM }));
  const ridersMeta = Object.fromEntries(decoded.parts.map((p) => [p.id, { displayName: p.displayName, isGhost: false }]));

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
          showSpeedos={false}
        />
      </div>

      <div className="race-recap__controls">
        <button type="button" className="race-recap__btn" data-testid="race-recap-play" onClick={() => {
          if (t >= decoded.maxLen - 1) setT(0);
          setPlaying((p) => !p);
        }}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type="range" className="race-recap__scrub" min={0} max={decoded.maxLen - 1} value={t}
          onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }}
          aria-label="scrub"
        />
      </div>

      <div className="race-recap__results">
        <RaceResults standings={standings} riders={ridersMeta} winCondition={candidate?.winCondition || 'distance'} />
      </div>
    </div>
  );
}

RaceRecap.propTypes = {
  candidate: PropTypes.object,
  onClose: PropTypes.func
};
