import React from 'react';
import { useScreenData } from '../../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { NutritionCard } from '../DashboardWidgets.jsx';
import { Skeleton } from '@mantine/core';

function parseNutritionHistory(raw) {
  if (!raw?.data || typeof raw.data !== 'object') return [];
  return Object.entries(raw.data)
    .filter(([, v]) => v?.nutrition)
    .map(([date, v]) => ({
      date,
      calories: v.nutrition.calories || 0,
      protein: v.nutrition.protein || 0,
      carbs: v.nutrition.carbs || 0,
      fat: v.nutrition.fat || 0,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export default function FitnessNutritionWidget() {
  const rawHealth = useScreenData('nutrition');
  if (!rawHealth) return <Skeleton height={200} />;
  const nutrition = parseNutritionHistory(rawHealth);
  return <NutritionCard nutrition={nutrition} />;
}
