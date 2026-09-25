import { useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState } from '../../../lib/ui';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { formatUsd, permissionLabel, triggerLabel } from './auditorFormat.js';

export const settingsLogPath = `${cleanupPath}/settings/log`;
const COLLAPSED = 10;
const FIELD_LABELS = {
  enabled: 'Automatic cleanup', dryRun: 'Preview only', telegram: 'Telegram questions',
  model: 'Model', dailyCapUsd: 'Daily cap', minGapMinutes: 'Minimum gap',
};

function fieldLabel(field) {
  const [group, kind] = field.split('.');
  if (group === 'permissions' && kind) return `${permissionLabel(kind)} permission`;
  if (group === 'triggers' && kind) return `${triggerLabel(kind)} trigger`;
  return FIELD_LABELS[field] || field;
}

function valueText(field, value) {
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (field === 'dailyCapUsd') return value == null ? 'No cap' : formatUsd(value, 2);
  if (field === 'minGapMinutes') return value ? `${value} min` : 'Off';
  return value == null ? '—' : String(value);
}

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export const logLine = entry => `${fieldLabel(entry.field)}: ${valueText(entry.field, entry.from)} → ${valueText(entry.field, entry.to)} · ${when(entry.at)}${entry.actor && entry.actor !== 'user' ? ` · by ${entry.actor}` : ''}`;

/** Who changed which auditor setting, newest first; the first ten shown until "Show all". */
export function SettingsLog() {
  const log = useApiResource(settingsLogPath, { swr: true });
  const [all, setAll] = useState(false);
  const entries = log.data?.entries || [];
  return <SectionCard title="Settings changes">
    {!log.data ? (log.error ? <ErrorState error={log.error} onRetry={log.reload} label="Settings changes" /> : <LoadingState label="Settings changes" rows={2} />)
      : !entries.length ? <Text size="sm" c="dimmed">No settings changes yet.</Text>
      : <Stack gap={4}>
        {(all ? entries : entries.slice(0, COLLAPSED)).map((entry, i) => <Text size="sm" key={`${entry.at}:${entry.field}:${i}`}>{logLine(entry)}</Text>)}
        {!all && entries.length > COLLAPSED ? <Button variant="subtle" size="xs" onClick={() => setAll(true)}>Show all ({entries.length})</Button> : null}
      </Stack>}
  </SectionCard>;
}

export default SettingsLog;
