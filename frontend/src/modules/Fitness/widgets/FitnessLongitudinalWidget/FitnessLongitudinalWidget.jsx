// frontend/src/modules/Fitness/widgets/FitnessLongitudinalWidget/FitnessLongitudinalWidget.jsx
import React, { useCallback } from 'react';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import SparklineRow from './SparklineRow.jsx';
import './FitnessLongitudinalWidget.scss';

function DailyGrid({ daily, selectedIndex, onSelect }) {
  if (!daily || daily.length === 0) return null;

  return (
    <div className="longitudinal-panel">
      <div className="longitudinal-panel__header">PAST 30 DAYS</div>
      <div className="longitudinal-panel__labels">
        <div className="sparkline-row__label" />
        {daily.map((d, i) => (
          <div key={i} className="longitudinal-panel__col-label">{d.dayOfWeek}</div>
        ))}
      </div>
      <SparklineRow label="Exercise Min" data={daily.map(d => d.exerciseMinutes)} color="rgba(34,139,230,0.6)" maxValue={90} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Cals Burned" data={daily.map(d => d.caloriesBurned || null)} color="rgba(200,80,40,0.5)" maxValue={600} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Steps" data={daily.map(d => d.steps)} color="rgba(80,200,120,0.35)" highlightColor="rgba(80,200,120,0.6)" highlightFn={v => v > 10000} maxValue={15000} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Protein (g)" data={daily.map(d => d.protein)} color="rgba(180,140,255,0.3)" highlightColor="rgba(180,140,255,0.6)" highlightFn={v => v >= 130} maxValue={180} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Cal +/−" data={daily.map(d => d.calorieBalance)} centerZero maxValue={600} selectedIndex={selectedIndex} onColumnClick={onSelect} />
    </div>
  );
}

function WeeklyGrid({ weekly, selectedIndex, onSelect }) {
  if (!weekly || weekly.length === 0) return null;

  return (
    <div className="longitudinal-panel">
      <div className="longitudinal-panel__header">PAST 6 MONTHS <span className="longitudinal-panel__header-sub">· weekly</span></div>
      <div className="longitudinal-panel__labels">
        <div className="sparkline-row__label" />
        {weekly.map((w, i) => (
          <div key={i} className="longitudinal-panel__col-label">{i % 4 === 0 ? w.label : ''}</div>
        ))}
      </div>
      <SparklineRow label="Weight" data={weekly.map(w => w.avgWeight)} color="rgba(255,255,255,0.4)" maxValue={Math.max(...weekly.map(w => w.avgWeight || 0).filter(Boolean)) * 1.02} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Wt Cal +/−" data={weekly.map(w => w.weightCalorieBalance)} centerZero maxValue={600} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Exer Cal/wk" data={weekly.map(w => w.exerciseCalories)} color="rgba(200,80,40,0.5)" maxValue={4000} selectedIndex={selectedIndex} onColumnClick={onSelect} />
      <SparklineRow label="Avg HR" data={weekly.map(w => w.avgExerciseHr)} color="rgba(255,100,100,0.3)" highlightColor="rgba(255,100,100,0.5)" highlightFn={v => v >= 140} maxValue={170} selectedIndex={selectedIndex} onColumnClick={onSelect} />
    </div>
  );
}

export default function FitnessLongitudinalWidget() {
  const rawData = useScreenData('longitudinal');
  const { longitudinalSelection, setLongitudinalSelection } = useFitnessScreen();

  const handleDaySelect = useCallback((index) => {
    const day = rawData?.daily?.[index];
    if (!day) return;
    setLongitudinalSelection({ type: 'day', index, data: day });
  }, [rawData, setLongitudinalSelection]);

  const handleWeekSelect = useCallback((index) => {
    const week = rawData?.weekly?.[index];
    if (!week) return;
    setLongitudinalSelection({ type: 'week', index, data: week });
  }, [rawData, setLongitudinalSelection]);

  if (rawData === null) {
    return <div className="longitudinal-skeleton"><div className="skeleton shimmer" style={{ height: '100%', borderRadius: 10 }} /></div>;
  }

  const dailyIdx = longitudinalSelection?.type === 'day' ? longitudinalSelection.index : null;
  const weeklyIdx = longitudinalSelection?.type === 'week' ? longitudinalSelection.index : null;

  return (
    <div className="longitudinal-widget">
      <DailyGrid daily={rawData.daily} selectedIndex={dailyIdx} onSelect={handleDaySelect} />
      <WeeklyGrid weekly={rawData.weekly} selectedIndex={weeklyIdx} onSelect={handleWeekSelect} />
    </div>
  );
}
