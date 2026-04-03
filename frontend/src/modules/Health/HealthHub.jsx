import React from 'react';
import { Title } from '@mantine/core';
import WeightCard from './cards/WeightCard';
import NutritionCard from './cards/NutritionCard';
import SessionsCard from './cards/SessionsCard';
import RecencyCard from './cards/RecencyCard';
import GoalsCard from './cards/GoalsCard';

export default function HealthHub({ dashboard, onCardClick, onRefresh }) {
  if (!dashboard) return null;
  const { today, recency, goals } = dashboard;

  return (
    <>
      <Title order={2} mb="md" c="white">Health</Title>
      <div className="health-hub-grid">
        <WeightCard
          weight={today?.weight}
          recency={recency?.find(r => r.source === 'weight')}
          onClick={() => onCardClick('weight')}
        />
        <NutritionCard
          nutrition={today?.nutrition}
          onRefresh={onRefresh}
          onClick={() => onCardClick('nutrition')}
        />
        <SessionsCard
          sessions={today?.sessions}
          onClick={() => onCardClick('sessions')}
        />
        <RecencyCard recency={recency} />
        <GoalsCard
          goals={goals}
          onClick={() => onCardClick('goals')}
        />
      </div>
    </>
  );
}
