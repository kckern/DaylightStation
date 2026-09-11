import { useCallback, useMemo, useState } from 'react';
import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, EmptyState, SectionCard, createAppLogger } from '@/lib/ui';

const logger = createAppLogger('admin').child('sessions');

/** A user agent is a paragraph; this is the two words that identify a device. */
function deviceLabel(userAgent) {
  if (!userAgent) return 'Unknown device';
  const ua = userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS/.test(ua) ? 'Mac'
      : /Windows/.test(ua) ? 'Windows' : /X11|Linux/.test(ua) ? 'Linux' : 'Unknown';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${browser}`;
}

const when = (iso) => {
  if (!iso) return '—';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/**
 * Signed-in devices, and the button that ends one.
 *
 * The session JWT is configured for ten years and nothing shortens it, so
 * "sign out" cannot mean waiting for a token to lapse — it means deleting the
 * record this list is drawn from. That is the whole reason this screen exists,
 * and it is why losing a phone is a thing a grown-up can act on rather than a
 * reason to rotate a household secret.
 */
export default function SessionsIndex() {
  const { data, loading, error, reload } = useApiResource('api/v1/auth/sessions', { label: 'sessions', logger });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const others = sessions.filter((row) => !row.current).length;

  const revoke = useCallback(async (id, label) => {
    if (busy) return;
    setBusy(id); setNotice(null);
    try {
      await DaylightAPI(`api/v1/auth/sessions/${encodeURIComponent(id)}`, {}, 'DELETE');
      logger.info('session.revoked', { id });
      setNotice(id === 'others' ? 'Signed out everywhere else.' : `Signed out ${label}.`);
      reload();
    } catch (err) {
      logger.warn('session.revoke_failed', { id, error: err.message });
      setNotice(err.message || 'Could not sign that device out.');
    } finally { setBusy(null); }
  }, [busy, reload]);

  if (loading) return <LoadingState label="sessions" rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Sessions" />;

  return (
    <SectionCard
      title="Signed-in devices"
      actions={others > 0 ? (
        <Button size="compact-xs" color="red" variant="light" loading={busy === 'others'}
          onClick={() => revoke('others', 'every other device')}>
          Sign out {others} other{others === 1 ? '' : 's'}
        </Button>
      ) : null}
    >
      <Stack gap="xs">
        {data?.revocable === false ? (
          <Text size="sm" c="dimmed">
            This deployment has no session store, so sessions cannot be listed or revoked.
          </Text>
        ) : null}
        {!sessions.length ? (
          <EmptyState title="Nobody is signed in"
            hint="A session appears here the first time someone signs in on a device." />
        ) : (
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Who</Table.Th>
                <Table.Th>Device</Table.Th>
                <Table.Th>Last seen</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sessions.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>
                    {row.username}{' '}
                    {row.current ? <Badge size="xs" variant="light">this device</Badge> : null}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{deviceLabel(row.userAgent)}</Text>
                    <Text size="xs" c="dimmed">{row.ip ?? 'unknown address'} · since {when(row.createdAt)}</Text>
                  </Table.Td>
                  <Table.Td><Text size="sm">{when(row.lastSeenAt)}</Text></Table.Td>
                  <Table.Td align="right">
                    {/* Signing out the device you are ON is legitimate and is
                        not hidden — it is how you leave a borrowed machine. */}
                    <Button size="compact-xs" variant="subtle" color="red"
                      loading={busy === row.id} disabled={Boolean(busy)}
                      onClick={() => revoke(row.id, deviceLabel(row.userAgent))}>
                      {row.current ? 'Sign out here' : 'Sign out'}
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {notice ? <Text size="xs" role="status">{notice}</Text> : null}
      </Stack>
    </SectionCard>
  );
}
