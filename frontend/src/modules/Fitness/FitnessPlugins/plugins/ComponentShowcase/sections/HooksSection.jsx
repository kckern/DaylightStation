import React, { useEffect, useRef, useState } from 'react';
import { CountdownRing, ElapsedTimer, ProgressRing, AppButton } from '../../../../shared';
import ComponentCard from '../components/ComponentCard';

const HooksSection = () => {
  const [countdownKey, setCountdownKey] = useState(0);
  const [animatedValue, setAnimatedValue] = useState(0);
  const [loopTick, setLoopTick] = useState(0);
  const rafRef = useRef(null);
  const [loopRunning, setLoopRunning] = useState(true);

  useEffect(() => {
    if (!loopRunning) return;
    const tick = () => {
      setLoopTick((v) => v + 1);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [loopRunning]);

  useEffect(() => {
    const id = setInterval(() => {
      setAnimatedValue((v) => (v + 10) % 100);
    }, 800);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="cs-demo-grid">
      <ComponentCard
        title="useCountdown (simulated)"
        description="Countdown ring resets via key to show hook-style behavior."
      >
        <CountdownRing key={countdownKey} duration={5} size={120} />
        <AppButton onClick={() => setCountdownKey((k) => k + 1)}>Restart</AppButton>
      </ComponentCard>

      <ComponentCard
        title="useAnimatedNumber (simulated)"
        description="Progress ring driven by interval-updated value."
      >
        <ProgressRing value={animatedValue} size="lg" />
      </ComponentCard>

      <ComponentCard
        title="useGameLoop (simulated)"
        description="RAF ticker increments continuously until paused."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Tick: {loopTick}</div>
          <AppButton size="sm" onClick={() => setLoopRunning((v) => !v)}>
            {loopRunning ? 'Pause' : 'Resume'}
          </AppButton>
        </div>
      </ComponentCard>

      <ComponentCard
        title="useElapsedTimer"
        description="Timer showing elapsed seconds since mount."
      >
        <ElapsedTimer startTime={Date.now()} format="mm:ss" />
      </ComponentCard>
    </div>
  );
};

export default HooksSection;
