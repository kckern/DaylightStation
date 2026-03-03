import React from 'react';
import { Text, Group, Stack, Paper } from '@mantine/core';
import { useScreenData } from '../../../../../screen-framework/data/ScreenDataProvider.jsx';
import { useFitnessScreen } from '../../../FitnessScreenProvider.jsx';
import { DashboardCard } from '../../DashboardCard.jsx';
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

export default function FitnessCoachWidget() {
  const dashboard = useScreenData('dashboard');
  const nutrition = useScreenData('nutrition');
  const { onCtaAction } = useFitnessScreen();

  if (!dashboard?.dashboard?.coach) return null;

  return (
    <CoachCard
      coach={dashboard.dashboard.coach}
      liveNutrition={nutrition?.data ? { logged: true } : null}
      onCtaAction={onCtaAction}
    />
  );
}
