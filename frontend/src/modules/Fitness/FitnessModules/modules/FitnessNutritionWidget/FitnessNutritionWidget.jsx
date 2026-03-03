import React from 'react';
import { Text, Group, Stack, Badge, Skeleton } from '@mantine/core';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { DashboardCard } from '../../DashboardCard.jsx';
import './FitnessNutritionWidget.scss';

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

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function FitnessNutritionWidget() {
  const rawHealth = useScreenData('nutrition');
  if (!rawHealth) return <Skeleton height={200} />;
  const nutrition = parseNutritionHistory(rawHealth);

  if (!nutrition || nutrition.length === 0) {
    return (
      <DashboardCard title="Nutrition" className="dashboard-card--nutrition">
        <Text c="dimmed" ta="center" py="md">No nutrition data</Text>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard title="Nutrition (cal)" className="dashboard-card--nutrition">
      <Stack gap={4}>
        {nutrition.map((day) => (
          <Group key={day.date} justify="space-between" className="nutrition-row" wrap="nowrap">
            <Text size="xs" c="dimmed" w={70}>{formatDateShort(day.date)}</Text>
            <Text size="sm" fw={600} w={55} ta="right">{day.calories}</Text>
            <Group gap={4} style={{ flex: 1 }} justify="flex-end" wrap="nowrap">
              <Badge variant="light" size="xs" color="blue">{Math.round(day.protein)}p</Badge>
              <Badge variant="light" size="xs" color="yellow">{Math.round(day.carbs)}c</Badge>
              <Badge variant="light" size="xs" color="orange">{Math.round(day.fat)}f</Badge>
            </Group>
          </Group>
        ))}
      </Stack>
    </DashboardCard>
  );
}
