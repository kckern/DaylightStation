import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, NumberInput, SegmentedControl, Select, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { SectionCard, LoadingState, ErrorState } from '../../../lib/ui';
import { DaylightAPI } from '../../../lib/api.mjs';
import { invalidateApiResources, patchApiResource } from '../../../lib/hooks/useApiResource.js';
import getLogger from '../../../lib/logging/Logger.js';
import { refreshHealthResources } from '../healthResources.js';
import { cleanupPath } from '../cleanup/CleanupQuestions.jsx';
import { settingsLogPath } from './SettingsLog.jsx';
import {
  AUDITOR_MODELS, PERMISSION_DESCRIPTIONS, SWITCHABLE_TRIGGERS, formatUsd, permissionLabel, serverMessage, triggerLabel,
} from './auditorFormat.js';

const GAP_OPTIONS = [{ label: 'Off', value: '0' }, { label: '15 min', value: '15' }, { label: '30 min', value: '30' }, { label: '60 min', value: '60' }];
const MAX_CAP = 50;
const capText = cap => (cap == null ? '' : cap);

/** Settings with one change applied (triggers and permissions merge per kind). */
function withChange(settings, change) {
  const next = { ...settings };
  for (const [key, value] of Object.entries(change)) {
    next[key] = key === 'triggers' || key === 'permissions' ? { ...settings[key], ...value } : value;
  }
  return next;
}

/** The cap as typed: blank is no cap (null), a number 0–50 is a cap, anything else is not valid (undefined). */
function parseCap(value) {
  if (value === '' || value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_CAP ? Math.round(n * 100) / 100 : undefined;
}

/**
 * Every auditor setting, each saved on its own as a versioned PATCH. `resource`
 * is the cleanup status poll, `spend` the spend summary (for cost per model).
 */
export function AuditorConfig({ resource, spend }) {
  const logger = useMemo(() => getLogger().child({ component: 'health-auditor' }), []);
  const [busy, setBusy] = useState(null);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState(null);
  const saved = resource.data?.settings;
  // While a save is in flight the control shows the value being saved; the
  // server's answer replaces it as soon as it arrives.
  const settings = saved && pending ? withChange(saved, pending) : saved;
  const settingsVersion = resource.data?.settingsVersion;
  const [cap, setCap] = useState(capText(saved?.dailyCapUsd));
  useEffect(() => { setCap(capText(saved?.dailyCapUsd)); }, [saved?.dailyCapUsd]);
  // An error stays until the next action: after a conflict the reload shows
  // the latest values, and the message says why the edit did not stick.

  const save = async (field, change) => {
    if (busy) return;
    setBusy(field); setPending(change); setError(null);
    try {
      const next = await DaylightAPI(`${cleanupPath}/settings`, { expectedSettingsVersion: settingsVersion ?? 0, ...change }, 'PATCH');
      // The PATCH answers with the new status: adopt it now, so the next edit carries the new settings version.
      if (!next || !patchApiResource(cleanupPath, () => next)) resource.reload();
      logger.info('health-auditor.settings.saved', { field, settingsVersion: next?.settingsVersion ?? null });
      if (field === 'enabled' || field === 'dryRun') refreshHealthResources();
      if (field === 'dailyCapUsd') spend?.reload?.();
    } catch (err) {
      const message = err.status === 409 ? 'Settings changed. Reload first.' : serverMessage(err);
      if (field === 'dailyCapUsd') setCap(capText(saved?.dailyCapUsd));
      resource.reload();
      setError(message);
      logger.warn('health-auditor.settings.failed', { field, status: err.status ?? null, error: message });
    } finally {
      setBusy(null); setPending(null);
      invalidateApiResources(path => path === settingsLogPath);
    }
  };
  const runNow = async () => {
    if (busy) return;
    setBusy('run'); setError(null);
    try {
      await DaylightAPI(`${cleanupPath}/run`, {}, 'POST');
      logger.info('health-auditor.run-now', { dryRun: settings.dryRun });
    } catch (err) {
      setError(serverMessage(err));
      logger.warn('health-auditor.run-now.failed', { error: err.message });
    } finally { setBusy(null); resource.reload(); }
  };
  const commitCap = () => {
    const next = parseCap(cap);
    if (next === undefined) { setError(`Daily cap must be between $0 and $${MAX_CAP}.`); setCap(capText(saved.dailyCapUsd)); return; }
    if (next === (saved.dailyCapUsd ?? null)) return;
    save('dailyCapUsd', { dailyCapUsd: next });
  };

  if (!settings) return resource.error ? <ErrorState error={resource.error} onRetry={resource.reload} label="Auditor settings" /> : <LoadingState label="Auditor settings" />;
  const disabled = !!busy;
  const running = (resource.data.runs || []).some(run => ['queued', 'running', 'retry'].includes(run.status));
  const byModel = Object.fromEntries((spend?.data?.byModel || []).map(row => [row.model, row]));
  const models = AUDITOR_MODELS.map(model => ({
    value: model,
    label: `${model} · ${!byModel[model]?.runs ? 'no runs yet' : byModel[model].avgUsd == null ? 'cost unknown' : `≈ ${formatUsd(byModel[model].avgUsd, 3)} / run`}`,
  }));

  return <SectionCard title="Auditor settings">
    <Stack gap="md">
      {error ? <Text size="sm" className="health-auditor__error" role="alert">{error}</Text> : null}
      <Stack gap="xs">
        <Switch label="Automatic cleanup" checked={settings.enabled} disabled={disabled} onChange={event => save('enabled', { enabled: event.currentTarget.checked })} />
        <Switch label="Preview only — do not change food or send questions" checked={settings.dryRun} disabled={disabled} onChange={event => save('dryRun', { dryRun: event.currentTarget.checked })} />
        <Switch label="Also show questions in Telegram" checked={settings.telegram} disabled={disabled} onChange={event => save('telegram', { telegram: event.currentTarget.checked })} />
        <Text size="sm" c="dimmed">Turning off cleanup cancels AI review. Estimates still stabilize automatically after 72 hours. Repairs and stabilization stay quiet; confirmation is optional.</Text>
        <Button variant="light" disabled={disabled || running} loading={busy === 'run'} onClick={runNow}>{settings.dryRun ? 'Preview cleanup now' : 'Run cleanup now'}</Button>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        <Select label="Model" data={models} value={settings.model} allowDeselect={false} disabled={disabled}
          onChange={value => { if (value && value !== settings.model) save('model', { model: value }); }} />
        <NumberInput label="Daily cap" description="Blank for no cap" value={cap} min={0} max={MAX_CAP} clampBehavior="none" decimalScale={2} step={0.25}
          prefix="$" disabled={disabled} onChange={setCap} onBlur={commitCap}
          onKeyDown={event => { if (event.key === 'Enter') commitCap(); }} />
      </SimpleGrid>
      <Stack gap={4}>
        <Text size="sm" fw={500}>Minimum gap between automatic runs</Text>
        <SegmentedControl data={GAP_OPTIONS} value={String(settings.minGapMinutes ?? 0)} disabled={disabled} fullWidth
          onChange={value => save('minGapMinutes', { minGapMinutes: Number(value) })} />
      </Stack>

      <Stack gap={6}>
        <Text size="sm" fw={500}>Run automatically when</Text>
        {SWITCHABLE_TRIGGERS.map(kind => <Checkbox key={kind} label={triggerLabel(kind)} checked={settings.triggers?.[kind] !== false} disabled={disabled}
          onChange={event => save(`triggers.${kind}`, { triggers: { [kind]: event.currentTarget.checked } })} />)}
      </Stack>

      <Stack gap={6}>
        <Text size="sm" fw={500}>What it may change</Text>
        {Object.keys(PERMISSION_DESCRIPTIONS).map(kind => <Switch key={kind} label={permissionLabel(kind)} description={PERMISSION_DESCRIPTIONS[kind]}
          checked={settings.permissions?.[kind] !== false} disabled={disabled}
          onChange={event => save(`permissions.${kind}`, { permissions: { [kind]: event.currentTarget.checked } })} />)}
      </Stack>
    </Stack>
  </SectionCard>;
}

export default AuditorConfig;
