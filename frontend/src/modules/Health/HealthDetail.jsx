import React from 'react';
import { Text } from '@mantine/core';
import HistoryChart from './detail/HistoryChart';
import WeightDetail from './detail/WeightDetail';
import NutritionDetail from './detail/NutritionDetail';
import SessionsDetail from './detail/SessionsDetail';
import GoalsDetail from './detail/GoalsDetail';

const TITLES = {
  weight: 'Weight',
  nutrition: 'Nutrition',
  sessions: 'Sessions',
  goals: 'Goals',
};

export default function HealthDetail({ type, dashboard, onBack }) {
  const showChart = type !== 'goals';

  return (
    <div className="health-detail">
      <Text
        className="health-detail__back"
        onClick={onBack}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onBack(); }}
      >
        ← {TITLES[type] || 'Back'}
      </Text>

      {showChart && dashboard?.history && (
        <HistoryChart history={dashboard.history} />
      )}

      {type === 'weight' && <WeightDetail dashboard={dashboard} />}
      {type === 'nutrition' && <NutritionDetail dashboard={dashboard} />}
      {type === 'sessions' && <SessionsDetail dashboard={dashboard} />}
      {type === 'goals' && <GoalsDetail goals={dashboard?.goals} />}
    </div>
  );
}
