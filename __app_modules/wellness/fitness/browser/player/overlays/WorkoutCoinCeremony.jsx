/**
 * WorkoutCoinCeremony — after a workout, what the ride was worth: one card per
 * kid, "+N" with the silver coin and the new total ("→ 27 silver"), the shape
 * of School's coin ceremony. A ride that crossed no coin says how many rings
 * the next one is. Tap, A/Enter, or the clock dismisses it — exactly once.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import CoinIcon from '@/lib/icons/CoinIcon.jsx';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';
// Fitness's own cue element (already unlocked on the garage kiosk); the coin
// sound itself is School's file on the media mount.
import { playRingCelebrationCue } from './ringCelebrationAudio.js';
import './WorkoutCoinCeremony.scss';

const COIN_SOUND = { sound: 'school/_ux/coin.mp3', volume: 0.8 };

export function ceremonyDurationMs(cards) {
  return Math.min(10000, 4000 + 1500 * Math.max(0, (cards || 1) - 1));
}

export default function WorkoutCoinCeremony({ sessionId, learners = [], onDone }) {
  const log = useMemo(() => getLogger().child({ component: 'workout-coin-ceremony' }), []);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = (reason) => {
    if (doneRef.current) return;
    doneRef.current = true;
    log.info('fitness.coin_ceremony.dismissed', { sessionId, reason });
    onDoneRef.current?.(reason);
  };

  useEffect(() => {
    const totalSilver = learners.reduce((s, l) => s + (l.gained?.silver || 0), 0);
    log.info('fitness.coin_ceremony.shown', { sessionId, learners: learners.length, totalSilver });
    learners.filter((l) => l.gained?.silver > 0).forEach(() => playRingCelebrationCue(COIN_SOUND));
    const timer = setTimeout(() => finish('timeout'), ceremonyDurationMs(learners.length));
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') finish('key'); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
    // Once per mount: the ceremony is for one finished session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="workout-coin-ceremony" data-testid="workout-coin-ceremony" role="dialog" aria-label="Workout coins" onPointerDown={() => finish('tap')}>
      <div className="workout-coin-ceremony__cards">
        {learners.map((l) => (
          <div key={l.learnerId} className="workout-coin-ceremony__card">
            <img className="workout-coin-ceremony__avatar" src={DaylightMediaPath(`/static/img/users/${l.learnerId}`)} alt="" />
            <div className="workout-coin-ceremony__name">{l.learnerName}</div>
            {l.gained?.silver > 0 ? (
              <>
                <div className="workout-coin-ceremony__gain">
                  <CoinIcon metal="silver" size="1em" label="silver" />
                  <span>+{l.gained.silver}</span>
                  {l.gained.gems > 0 ? (
                    <GemIcon className="workout-coin-ceremony__gem" size="0.8em" label={`${l.gained.gems} gem`} />
                  ) : null}
                </div>
                <div className="workout-coin-ceremony__total">→ {l.total?.silver ?? 0} silver</div>
              </>
            ) : (
              <div className="workout-coin-ceremony__next">
                {l.rings} rings{l.nextCoinIn ? ` · ${l.nextCoinIn} more rings to the next coin` : ''}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
