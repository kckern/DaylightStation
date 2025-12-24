import React, { useMemo, useState } from 'react';
import { AppButton, Gauge, ProgressBar, ProgressRing, NumericKeypad, TouchSlider, StatusBadge } from '../../../../shared';
import useFitnessPlugin from '../../../useFitnessPlugin';
import ComponentCard from '../components/ComponentCard';

const PrimitivesSection = ({ components }) => {
  const { userVitalsMap, sessionActive, userCurrentZones = [] } = useFitnessPlugin('component_showcase');
  const [progress, setProgress] = useState(42);
  const [gaugeValue, setGaugeValue] = useState(120);
  const [ringValue, setRingValue] = useState(65);
  const [keypadValue, setKeypadValue] = useState('');

  const liveHeartRate = useMemo(() => {
    if (!userVitalsMap || typeof userVitalsMap.values !== 'function') return null;
    for (const val of userVitalsMap.values()) {
      const bpm = Number(val?.heartRate ?? val?.hr ?? val?.bpm);
      if (Number.isFinite(bpm)) return bpm;
    }
    return null;
  }, [userVitalsMap]);

  const currentZone = useMemo(() => {
    const primary = Array.isArray(userCurrentZones) ? userCurrentZones[0] : null;
    return Number(primary?.zone || primary?.zoneId || primary) || 0;
  }, [userCurrentZones]);

  const gaugeDisplay = Number.isFinite(liveHeartRate) ? liveHeartRate : gaugeValue;
  const progressDisplay = progress;
  const ringDisplay = ringValue;

  return (
    <div className="cs-demo-grid">
      <ComponentCard
        title="AppButton"
        description="Primary, secondary, ghost, and danger variants with hover/active states."
        badge="Interactive"
      >
        <div className="cs-btn-row" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <AppButton variant="primary">Primary</AppButton>
          <AppButton variant="secondary">Secondary</AppButton>
          <AppButton variant="ghost">Ghost</AppButton>
          <AppButton variant="danger">Danger</AppButton>
          <AppButton variant="success">Success</AppButton>
        </div>
      </ComponentCard>

      <ComponentCard
        title="Gauge"
        description="Heart rate gauge with live context fallback to slider."
        badge={Number.isFinite(liveHeartRate) ? 'Live data' : 'Demo'}
      >
        <Gauge
          value={gaugeDisplay}
          min={50}
          max={190}
          label="Heart Rate"
          units="BPM"
          zone={currentZone || undefined}
          zones={[
            { min: 0, max: 95, color: 'var(--zone-gray)' },
            { min: 95, max: 114, color: 'var(--zone-blue)' },
            { min: 114, max: 133, color: 'var(--zone-green)' },
            { min: 133, max: 152, color: 'var(--zone-yellow)' },
            { min: 152, max: 171, color: 'var(--zone-orange)' },
            { min: 171, max: 200, color: 'var(--zone-red)' }
          ]}
        />
        {!Number.isFinite(liveHeartRate) && (
          <TouchSlider
            min={60}
            max={190}
            value={gaugeValue}
            onChange={(v) => setGaugeValue(Number(v))}
          />
        )}
      </ComponentCard>

      <ComponentCard
        title="Progress Bar"
        description="Default, striped, and gradient examples with slider control."
      >
        <ProgressBar value={progressDisplay} label={`${progressDisplay}%`} />
        <ProgressBar value={progressDisplay} variant="striped" label="Striped" />
        <ProgressBar value={progressDisplay} variant="gradient" label="Gradient" />
        <TouchSlider min={0} max={100} value={progress} onChange={(v) => setProgress(Number(v))} />
      </ComponentCard>

      <ComponentCard
        title="Progress Ring"
        description="Ring with adjustable value and zone tint."
      >
        <ProgressRing value={ringDisplay} size="lg" />
        <TouchSlider min={0} max={100} value={ringValue} onChange={(v) => setRingValue(Number(v))} />
      </ComponentCard>

      <ComponentCard
        title="Numeric Keypad"
        description="Touch-friendly keypad with live value display."
      >
        <div style={{ display: 'grid', gap: '8px' }}>
          <div className="cs-keypad-value">Value: {keypadValue || '—'}</div>
          <NumericKeypad value={keypadValue} onChange={setKeypadValue} maxLength={6} />
        </div>
      </ComponentCard>

      <ComponentCard
        title="Status Badge"
        description="Connection indicator with live/demo state."
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <StatusBadge status={sessionActive ? 'active' : 'idle'} label={sessionActive ? 'Connected' : 'Demo'} />
          <StatusBadge status="warning" label="Buffering" pulse />
          <StatusBadge status="error" label="Error" />
        </div>
      </ComponentCard>
      {/* Additional primitives can iterate components. For now we render curated set. */}
    </div>
  );
};

export default PrimitivesSection;
