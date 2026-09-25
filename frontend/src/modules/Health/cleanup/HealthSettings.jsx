import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Group, Stack, Switch, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { refreshHealthResources } from '../healthResources.js';
import { cleanupPath, useCleanup, CleanupQuestions } from './CleanupQuestions.jsx';
import { formatUsd, formatWhen, spentToday } from '../auditor/auditorFormat.js';
import HealthDisplaySettings from '../display/HealthDisplaySettings.jsx';
import { ArtworkQueue } from './ArtworkQueue.jsx';

export function CleanupSettings() {
  const resource = useCleanup();
  const spend = useApiResource(`${cleanupPath}/spend?days=30`, { swr: true });
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mutate = async (path, body, method = 'POST') => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await DaylightAPI(`${cleanupPath}/${path}`, body, method);
      resource.reload(); spend.reload(); refreshHealthResources();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  if (!resource.data) return resource.error ? <ErrorState error={resource.error} onRetry={resource.reload} label="Cleanup settings" /> : <LoadingState label="Cleanup settings" />;
  const settings = resource.data.settings;
  const lastRun = resource.data.runs[0];
  const today = spentToday(spend.data);
  const statusLine = [lastRun ? `Last run ${formatWhen(lastRun.completedAt || lastRun.createdAt)}` : 'No runs yet',
    Number.isFinite(today) ? `${formatUsd(today, 2)} today` : null].filter(Boolean).join(' · ');
  return <Stack gap="md">
    <SectionCard title="Nutrition cleanup">
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm" c="dimmed">{statusLine}</Text>
          <Button size="xs" variant="light" onClick={() => navigate('/health/auditor')}>Open auditor</Button>
        </Group>
        <Text size="sm">Scans count immediately as estimates. Cleanup can refine provisional entries for 72 hours using capture evidence and older meals as reference. It preserves your corrections and never invents consumption. Changes and evidence are recorded in the auditor.</Text>
        <Switch label="Automatic cleanup" checked={settings.enabled} disabled={busy} onChange={event => mutate('settings', { expectedVersion: resource.data.version, enabled: event.currentTarget.checked }, 'PATCH')} />
        <Switch label="Preview only — do not change food or send questions" checked={settings.dryRun} disabled={busy} onChange={event => mutate('settings', { expectedVersion: resource.data.version, dryRun: event.currentTarget.checked }, 'PATCH')} />
        <Switch label="Also show questions in Telegram" checked={settings.telegram} disabled={busy} onChange={event => mutate('settings', { expectedVersion: resource.data.version, telegram: event.currentTarget.checked }, 'PATCH')} />
        <Text size="sm" c="dimmed">Turning off cleanup cancels AI review. Estimates still stabilize automatically after 72 hours. Repairs and stabilization stay quiet; confirmation is optional.</Text>
        <Button variant="light" disabled={busy || resource.data.runs.some(run => ['queued', 'running', 'retry'].includes(run.status))} onClick={() => mutate('run', {})}>{settings.dryRun ? 'Preview cleanup now' : 'Run cleanup now'}</Button>
        {error ? <Text c="red" role="alert">{error}</Text> : null}
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
