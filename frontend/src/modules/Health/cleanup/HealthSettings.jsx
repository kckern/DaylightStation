import { useNavigate } from 'react-router-dom';
import { Button, Group, Stack, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState } from '../../../lib/ui';
import { useCleanup, CleanupQuestions } from './CleanupQuestions.jsx';
import { formatUsd, formatWhen, spentToday } from '../auditor/auditorFormat.js';
import { useAuditorSpend } from '../auditor/useAuditorSpend.js';
import HealthDisplaySettings from '../display/HealthDisplaySettings.jsx';
import { ArtworkQueue } from './ArtworkQueue.jsx';

/** Settings' view of the nutrition auditor: a status line and the way into the auditor page, where its controls live. */
export function CleanupSettings() {
  const resource = useCleanup();
  const spend = useAuditorSpend(resource);
  const navigate = useNavigate();
  if (!resource.data) return resource.error ? <ErrorState error={resource.error} onRetry={resource.reload} label="Cleanup settings" /> : <LoadingState label="Cleanup settings" />;
  const { settings } = resource.data;
  const lastRun = resource.data.runs[0];
  const today = spentToday(spend.data);
  const state = !settings.enabled ? 'Off' : settings.dryRun ? 'Preview only' : 'On';
  const statusLine = [state, lastRun ? `Last run ${formatWhen(lastRun.completedAt || lastRun.createdAt)}` : 'No runs yet',
    Number.isFinite(today) ? `${formatUsd(today, 2)} today` : null].filter(Boolean).join(' · ');
  return <Stack gap="md">
    <SectionCard title="Nutrition cleanup">
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm" c="dimmed">{statusLine}</Text>
          <Button size="xs" variant="light" onClick={() => navigate('/health/auditor')}>Open auditor</Button>
        </Group>
        <Text size="sm">Scans count immediately as estimates. Cleanup can refine provisional entries for 72 hours using capture evidence and older meals as reference. It preserves your corrections and never invents consumption. Its switches, spend and every change it made are in the auditor.</Text>
      </Stack>
    </SectionCard>
    <CleanupQuestions />
    <ArtworkQueue />
  </Stack>;
}

export function HealthSettings() {
  return <Stack gap="md"><HealthDisplaySettings /><CleanupSettings /></Stack>;
}

export default HealthSettings;
