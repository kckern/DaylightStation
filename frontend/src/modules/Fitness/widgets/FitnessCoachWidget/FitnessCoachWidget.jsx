import React from 'react';
import { Text, Group, Stack, Paper } from '@mantine/core';
import { useScreenData } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import { DashboardCard } from '../_shared/DashboardCard.jsx';
import './FitnessCoachWidget.scss';

function ctaIcon(type) {
  switch (type) {
    case 'data_gap': return '\u26A0';
    case 'observation': return '\uD83D\uDCC8';
    case 'nudge': return '\u27A1';
    default: return '\u2022';
  }
}

function CoachCard({ coach, liveNutrition, onCtaAction }) {
  if (!coach) return null;

  const activeCtas = (coach.cta || []).filter(cta => {
    if (cta.type === 'data_gap' && cta.action === 'open_nutrition' && liveNutrition?.logged) {
      return false;
    }
    return true;
  });

  return (
    <DashboardCard className="dashboard-card--coach">
      {coach.briefing && (
        <div className="coach-briefing">
          <Text size="md" lh={1.5}>{coach.briefing}</Text>
        </div>
      )}

      {activeCtas.length > 0 && (
        <Stack gap="xs" mt="md">
          {activeCtas.map((cta, i) => (
            <Paper
              key={i}
              className={`coach-cta coach-cta--${cta.type}`}
              p="sm"
              radius="sm"
              onPointerDown={() => onCtaAction?.(cta)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onCtaAction?.(cta); }}
              role={cta.action ? 'button' : undefined}
              tabIndex={cta.action ? 0 : undefined}
            >
              <Group gap="xs" wrap="nowrap">
                <Text size="sm">{ctaIcon(cta.type)}</Text>
                <Text size="sm">{cta.message}</Text>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}

      {coach.prompts?.length > 0 && (
        <Stack gap="xs" mt="md">
          {coach.prompts.map((prompt, i) => (
            <div key={i} className="coach-prompt">
              <Text size="sm" fw={500} mb="xs">{prompt.question}</Text>
              {prompt.type === 'multiple_choice' && prompt.options && (
                <Group gap="xs">
                  {prompt.options.map((opt, j) => (
                    <Paper
                      key={j}
                      className="prompt-option"
                      p="xs"
                      radius="sm"
                      role="button"
                      tabIndex={0}
                      onPointerDown={() => {/* Phase 5: interactive coaching */}}
                    >
                      <Text size="sm">{opt}</Text>
                    </Paper>
                  ))}
                </Group>
              )}
            </div>
          ))}
        </Stack>
      )}
    </DashboardCard>
  );
}

function LongitudinalDayCard({ data }) {
  return (
    <DashboardCard className="dashboard-card--coach">
      <Text size="sm" fw={700} mb="xs">{new Date(data.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
      <Stack gap={4}>
        <Text size="xs" c="dimmed">Exercise: {data.exerciseMinutes} min</Text>
        <Text size="xs" c="dimmed">Burned: {data.caloriesBurned} cal</Text>
        {data.steps != null && <Text size="xs" c="dimmed">Steps: {data.steps.toLocaleString()}</Text>}
        {data.protein != null && <Text size="xs" c="dimmed">Protein: {data.protein}g</Text>}
        {data.calorieBalance != null && <Text size="xs" c="dimmed">Balance: {data.calorieBalance > 0 ? '+' : ''}{data.calorieBalance} cal</Text>}
      </Stack>
    </DashboardCard>
  );
}

function LongitudinalWeekCard({ data }) {
  return (
    <DashboardCard className="dashboard-card--coach">
      <Text size="sm" fw={700} mb="xs">{data.label} — {new Date(data.weekEnd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
      <Stack gap={4}>
        {data.avgWeight != null && <Text size="xs" c="dimmed">Avg Weight: {data.avgWeight} lb</Text>}
        {data.weightCalorieBalance != null && <Text size="xs" c="dimmed">Wt Balance: {data.weightCalorieBalance > 0 ? '+' : ''}{Math.round(data.weightCalorieBalance)}/day</Text>}
        <Text size="xs" c="dimmed">Exercise: {data.exerciseCalories.toLocaleString()} cal</Text>
        {data.avgExerciseHr != null && <Text size="xs" c="dimmed">Avg HR: {Math.round(data.avgExerciseHr)} bpm</Text>}
      </Stack>
    </DashboardCard>
  );
}

export default function FitnessCoachWidget() {
  const dashboard = useScreenData('dashboard');
  const nutrition = useScreenData('nutrition');
  const { onCtaAction, longitudinalSelection } = useFitnessScreen();

  // Longitudinal drill-down takes priority
  if (longitudinalSelection?.data) {
    if (longitudinalSelection.type === 'day') {
      return <LongitudinalDayCard data={longitudinalSelection.data} />;
    }
    if (longitudinalSelection.type === 'week') {
      return <LongitudinalWeekCard data={longitudinalSelection.data} />;
    }
  }

  if (!dashboard?.dashboard?.coach) return null;

  return (
    <CoachCard
      coach={dashboard.dashboard.coach}
      liveNutrition={nutrition?.data ? { logged: true } : null}
      onCtaAction={onCtaAction}
    />
  );
}
