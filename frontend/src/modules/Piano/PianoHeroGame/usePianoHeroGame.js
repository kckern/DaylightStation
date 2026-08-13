import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChildLogger } from '../../../lib/logging/singleton.js';
import { advanceHeroRun, applyHeroPress, createHeroRun, heroAssessment, HERO_DEFAULTS } from './heroChart.js';

const TICK_MS = 32;

export function usePianoHeroGame({ chart, subscribe, config = {} }) {
  const logger = useMemo(() => getChildLogger({ component: 'piano-hero-game' }), []);
  const timing = useMemo(() => ({
    ...HERO_DEFAULTS,
    ...config?.timing,
    fallDurationMs: config?.fallDurationMs ?? chart?.fallDurationMs ?? HERO_DEFAULTS.fallDurationMs,
  }), [config, chart?.fallDurationMs]);
  const [phase, setPhase] = useState('ready');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [run, setRun] = useState(() => createHeroRun(chart));
  const [result, setResult] = useState(null);
  const runRef = useRef(run);
  const startedAtRef = useRef(0);
  const completedRef = useRef(false);

  useEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    const fresh = createHeroRun(chart);
    runRef.current = fresh;
    completedRef.current = false;
    setRun(fresh);
    setResult(null);
    setElapsedMs(0);
    setPhase('ready');
  }, [chart]);

  const start = useCallback(() => {
    const fresh = createHeroRun(chart);
    runRef.current = fresh;
    completedRef.current = false;
    startedAtRef.current = Date.now();
    setRun(fresh);
    setResult(null);
    setElapsedMs(0);
    setPhase('playing');
    logger.info('hero.started', { targets: fresh.targets.length, tempo: chart?.tempo });
  }, [chart, logger]);

  useEffect(() => {
    if (phase !== 'playing' || !subscribe) return undefined;
    return subscribe((event) => {
      if (event?.type !== 'note_on' || !event.velocity) return;
      const elapsed = Math.max(0, (event.time || Date.now()) - startedAtRef.current);
      const next = applyHeroPress(runRef.current, event.note, elapsed, timing);
      runRef.current = next;
      setRun(next);
    });
  }, [phase, subscribe, timing]);

  useEffect(() => {
    if (phase !== 'playing') return undefined;
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current;
      const next = advanceHeroRun(runRef.current, elapsed, timing);
      if (next !== runRef.current) {
        runRef.current = next;
        setRun(next);
      }
      setElapsedMs(elapsed);
      if (
        !completedRef.current
        && elapsed >= (chart?.durationMs || 0)
        && next.targets.length > 0
        && next.targets.every((target) => target.state !== 'pending')
      ) {
        completedRef.current = true;
        const assessment = heroAssessment(next, { achievedBpm: chart?.tempo });
        setResult(assessment);
        setPhase('complete');
        logger.info('hero.completed', {
          ...next.score, targets: next.targets.length, assessmentScore: assessment?.score,
        });
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, timing, chart?.durationMs, chart?.tempo, logger]);

  return { phase, elapsedMs, run, result, timing, start };
}

export default usePianoHeroGame;
