import { useState } from 'react';
import { Stack, Paper, Title, Group, Switch, TextInput, Table, Button, Badge, NumberInput, Text, Loader } from '@mantine/core';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { ErrorState } from '../../../lib/ui/states.jsx';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * SYSTEM > Notifications admin page.
 *
 * Lets a parent tune quiet hours + per-category cooldowns (GET/PUT
 * /api/v1/admin/notifications) and inspect the live delivery ledger
 * (GET /api/v1/admin/notifications/ledger). Save PUTs the FULL config
 * object back (backend does a full replace, not a patch).
 *
 * NOTE: DaylightAPI's real signature is (path, data = {}, method = 'GET')
 * — see frontend/src/lib/api.mjs — not (path, method, data).
 */
export function NotificationsIndex() {
  const settings = useApiResource('/api/v1/admin/notifications');
  const ledger = useApiResource('/api/v1/admin/notifications/ledger?limit=50');

  return (
    <Stack gap="md" p="md">
      <Title order={3}>Notifications</Title>
      {settings.error && <ErrorState label="Notification settings" error={settings.error} onRetry={settings.reload} />}
      {settings.loading && <Loader />}
      {settings.data && <NotificationSettings initial={settings.data} />}
      <ActivityLedger ledger={ledger} />
    </Stack>
  );
}

function NotificationSettings({ initial }) {
  const [config, setConfig] = useState(() => ({ quiet_hours: initial.quiet_hours, cooldowns: initial.cooldowns }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const saved = await DaylightAPI('/api/v1/admin/notifications', config, 'PUT');
      // Inputs stay editable while the PUT is in flight. Only replace the draft that was submitted.
      setConfig(current => current === config
        ? { quiet_hours: saved.quiet_hours, cooldowns: saved.cooldowns }
        : current);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const qh = config.quiet_hours;
  const setQh = (patch) => setConfig((c) => ({ ...c, quiet_hours: { ...c.quiet_hours, ...patch } }));
  const setCooldown = (k, v) => setConfig((c) => ({ ...c, cooldowns: { ...c.cooldowns, [k]: v } }));

  return (
    <>
      {error && <Text c="red">{error}</Text>}

      <Paper p="md" withBorder>
        <Group justify="space-between" mb="sm"><Title order={5}>Quiet hours</Title>
          <Switch checked={qh.enabled} onChange={(e) => setQh({ enabled: e.currentTarget.checked })} label="Enabled" /></Group>
        <Group>
          <TextInput label="Start" value={qh.start} onChange={(e) => setQh({ start: e.currentTarget.value })} w={120} />
          <TextInput label="End" value={qh.end} onChange={(e) => setQh({ end: e.currentTarget.value })} w={120} />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">Non-critical notifications are suppressed during this window (household-local).</Text>
      </Paper>

      <Paper p="md" withBorder>
        <Title order={5} mb="sm">Cooldowns (minutes)</Title>
        <Table>
          <Table.Thead><Table.Tr><Table.Th>Category</Table.Th><Table.Th>Minutes</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {Object.entries(config.cooldowns).map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td>{k}</Table.Td>
                <Table.Td><NumberInput value={v} min={0} onChange={(val) => setCooldown(k, Number(val) || 0)} w={120} /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Group><Button onClick={save} loading={saving}>Save</Button></Group>
    </>
  );
}

function ActivityLedger({ ledger }) {
  const events = ledger.data?.events || [];
  return (
    <Paper p="md" withBorder>
      <Group justify="space-between" mb="sm"><Title order={5}>Recent activity</Title>
        {!ledger.error && <Button size="xs" variant="light" onClick={ledger.reload} disabled={ledger.loading}>Refresh</Button>}
      </Group>
      {ledger.error && <ErrorState label="Recent activity" error={ledger.error} onRetry={ledger.reload} />}
      {ledger.loading && <Loader />}
      <Table>
        <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>User</Table.Th><Table.Th>Category</Table.Th><Table.Th>Result</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {events.map((e, i) => (
            <Table.Tr key={i}>
              <Table.Td>{new Date(e.at).toLocaleString()}</Table.Td>
              <Table.Td>{e.username || '—'}</Table.Td>
              <Table.Td>{e.category}</Table.Td>
              <Table.Td>{e.suppressed
                ? <Badge color="gray" variant="light">suppressed · {e.reason}</Badge>
                : <Badge color="green" variant="light">sent</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

export default NotificationsIndex;
