import { useMemo, useEffect } from 'react';
import { Stack, Paper, Title, Text, Group, SimpleGrid, Button, Anchor } from '@mantine/core';
import { Link } from 'react-router-dom';
import { IconCircleCheck, IconCircle } from '@tabler/icons-react';
import { useAlignment } from "../../hooks/useAlignment.js";
import { useLifePlan } from "../../hooks/useLifePlan.js";
import { CadenceIndicator } from "../../widgets/CadenceIndicator.jsx";
import { DriftGauge } from "../../widgets/DriftGauge.jsx";
import { GoalProgressBar } from "../../widgets/GoalProgressBar.jsx";
import { BeliefConfidenceChip } from "../../widgets/BeliefConfidenceChip.jsx";
import { ValueAllocationChart } from "../../widgets/ValueAllocationChart.jsx";
import { PriorityList } from "./PriorityList.jsx";
import { LoadingState, ErrorState, SectionCard } from "../../components/index.js";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";

function ChecklistRow({ done, label, to }) {
  const action = done ? {} : { component: Link, to, className: 'life-dashboard-link ds-touch-target' };
  return (
    <Group gap="xs" {...action}>
      {done ? <IconCircleCheck size={18} color="var(--mantine-color-teal-5)" aria-hidden /> : <IconCircle size={18} color="var(--mantine-color-dimmed)" aria-hidden />}
      <Text size="sm" c={done ? 'dimmed' : undefined} td={done ? 'line-through' : undefined}>{label}</Text>
    </Group>
  );
}

export function Dashboard() {
  const logger = useMemo(() => getLogger().child({ component: 'life-dashboard' }), []);
  const priorityRead = useAlignment('priorities');
  const summaryRead = useAlignment('dashboard');
  const { isEmpty: planIsEmpty, loading: planLoading, error: planError, refetch: refetchPlan } = useLifePlan();
  const dashboard = summaryRead.data?.dashboard;
  const stage = dashboard?.stage;
  const completeness = dashboard?.completeness;

  useEffect(() => {
    logger.info('life.dashboard.mounted');
    return () => logger.debug('life.dashboard.unmounted');
  }, [logger]);

  useEffect(() => {
    if (!priorityRead.loading && !summaryRead.loading && !planLoading
      && !priorityRead.error && !summaryRead.error && !planError) {
      logger.info('life.dashboard.loaded', {
        goalCount: dashboard?.goalProgress?.length || 0,
        beliefCount: dashboard?.beliefConfidence?.length || 0,
        hasDrift: !!dashboard?.valueDrift,
        priorityCount: priorityRead.data?.priorities?.length || 0,
        planEmpty: planIsEmpty,
      });
    }
  }, [priorityRead.loading, priorityRead.error, priorityRead.data, summaryRead.loading, summaryRead.error, dashboard, planLoading, planError, planIsEmpty, logger]);

  if (planLoading) {
    return <LoadingState />;
  }

  if (planError) return <ErrorState label="Life plan" error={planError} onRetry={refetchPlan} />;

  return (
    <Stack gap="md">
      {planIsEmpty && (
        <SectionCard>
          <Stack gap="sm">
            <Title order={4}>You don&apos;t have a life plan yet</Title>
            <Text c="dimmed">
              Ten minutes with your coach gets you a working plan — values, a goal or two,
              and your first check-in tomorrow morning.
            </Text>
            <Group gap="md" mt="xs">
              <Button component={Link} to="/life/coach">Talk to your coach</Button>
              <Anchor component={Link} to="/life/log" size="sm" c="dimmed">
                Browse my life log first
              </Anchor>
            </Group>
          </Stack>
        </SectionCard>
      )}

      {!planIsEmpty && stage === 'scaffolding' && completeness && (
        <SectionCard title="Finish setting up">
          <Stack gap="xs">
            <ChecklistRow done={completeness.hasPurpose} label="Name your purpose" to="/life/plan" />
            <ChecklistRow done={completeness.valueCount >= 2} label="Add a couple of values" to="/life/plan/values" />
            <ChecklistRow done={completeness.goalCount >= 1} label="Set your first goal" to="/life/plan/goals" />
          </Stack>
        </SectionCard>
      )}

      {dashboard?.cadencePosition && (
        <CadenceIndicator cadencePosition={dashboard.cadencePosition} />
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper p="md" withBorder>
          <Title order={5} mb="sm">Priorities</Title>
          {priorityRead.loading ? <LoadingState label="priorities" rows={2} /> : priorityRead.error ? (
            <ErrorState label="Priorities" error={priorityRead.error} onRetry={priorityRead.refetch} />
          ) : <PriorityList priorities={priorityRead.data?.priorities ?? []} />}
        </Paper>

        <Stack gap="md">
          {summaryRead.loading && <LoadingState label="dashboard summary" rows={2} />}
          {summaryRead.error && <ErrorState label="Dashboard summary" error={summaryRead.error} onRetry={summaryRead.refetch} />}
          {dashboard?.valueDrift && (
            <Paper p="md" withBorder>
              <DriftGauge
                correlation={dashboard.valueDrift.correlation}
                status={dashboard.valueDrift.status}
              />
              {dashboard.valueDrift.allocation && (
                <ValueAllocationChart allocation={dashboard.valueDrift.allocation} />
              )}
            </Paper>
          )}
        </Stack>
      </SimpleGrid>

      {dashboard?.goalProgress?.length > 0 && (
        <Paper p="md" withBorder>
          <Title order={5} mb="sm">Active Goals</Title>
          <Stack gap="sm">
            {dashboard.goalProgress.map(g => (
              <GoalProgressBar key={g.id} name={g.name} state={g.state} progress={g.progress} />
            ))}
          </Stack>
        </Paper>
      )}

      {dashboard?.beliefConfidence?.length > 0 && (
        <Paper p="md" withBorder>
          <Title order={5} mb="sm">Beliefs</Title>
          <Group gap="xs">
            {dashboard.beliefConfidence.map(b => (
              <BeliefConfidenceChip key={b.id} belief={b} />
            ))}
          </Group>
        </Paper>
      )}
    </Stack>
  );
}
