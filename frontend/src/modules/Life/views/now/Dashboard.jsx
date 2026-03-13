import { useMemo, useEffect } from 'react';
import { Stack, Paper, Title, Text, Group, Loader, SimpleGrid } from '@mantine/core';
import { useAlignment } from '../../hooks/useAlignment.js';
import { CadenceIndicator } from '../../widgets/CadenceIndicator.jsx';
import { DriftGauge } from '../../widgets/DriftGauge.jsx';
import { GoalProgressBar } from '../../widgets/GoalProgressBar.jsx';
import { BeliefConfidenceChip } from '../../widgets/BeliefConfidenceChip.jsx';
import { ValueAllocationChart } from '../../widgets/ValueAllocationChart.jsx';
import { PriorityList } from './PriorityList.jsx';
import getLogger from '../../../../lib/logging/Logger.js';

export function Dashboard() {
  const logger = useMemo(() => getLogger().child({ component: 'life-dashboard' }), []);
  const { data: priorityData, loading: pLoading } = useAlignment('priorities');
  const { data: dashData, loading: dLoading } = useAlignment('dashboard');

  useEffect(() => {
    logger.info('life.dashboard.mounted');
    return () => logger.debug('life.dashboard.unmounted');
  }, [logger]);

  useEffect(() => {
    if (!pLoading && !dLoading) {
      const dashboard = dashData?.dashboard;
      logger.info('life.dashboard.loaded', {
        goalCount: dashboard?.goalProgress?.length || 0,
        beliefCount: dashboard?.beliefConfidence?.length || 0,
        hasDrift: !!dashboard?.valueDrift,
        priorityCount: priorityData?.priorities?.length || 0,
      });
    }
  }, [pLoading, dLoading, dashData, priorityData, logger]);

  if (pLoading || dLoading) {
    return <Loader size="sm" />;
  }

  const dashboard = dashData?.dashboard;
  const priorities = priorityData?.priorities || [];

  return (
    <Stack gap="md">
      {dashboard?.cadencePosition && (
        <CadenceIndicator cadencePosition={dashboard.cadencePosition} />
      )}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Paper p="md" withBorder>
          <Title order={5} mb="sm">Priorities</Title>
          <PriorityList priorities={priorities} />
        </Paper>

        <Stack gap="md">
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
