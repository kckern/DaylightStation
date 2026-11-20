import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { subscribeToken } from '../../../lib/auth.js';
import { invalidateApiResources, useApiResource } from '../../../lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, EmptyState, SectionCard, StateMessage, createAppLogger, useRetryRegion } from '@/lib/ui';

const sessionsPath = 'api/v1/auth/sessions';
const logger = createAppLogger('admin').child('sessions');
const SessionRevocationContext = createContext(null);

// The Admin layout owns the active command across visits to the roster.
export function SessionRevocationProvider({ children }) {
  const pending = useRef(null);
  const [busy, setBusy] = useState(null);
  const [authVisit, setAuthVisit] = useState(0);

  useLayoutEffect(() => {
    const unsubscribe = subscribeToken(() => {
      pending.current = null;
      setBusy(null);
      setAuthVisit(visit => visit + 1);
    });
    return () => {
      unsubscribe();
      pending.current = null;
    };
  }, []);

  const startRevocation = useCallback(id => {
    if (pending.current) return null;
    const operation = Symbol();
    pending.current = operation;
    setBusy(id);

    return DaylightAPI(`${sessionsPath}/${encodeURIComponent(id)}`, {}, 'DELETE')
      .then(() => {
        logger.info('session.revoked', { id });
        if (pending.current === operation) invalidateApiResources(path => path === sessionsPath);
      })
      .catch(err => {
        logger.warn('session.revoke_failed', { id, error: err.message });
        throw err;
      })
      .finally(() => {
        if (pending.current === operation) {
          pending.current = null;
          setBusy(null);
        }
      });
  }, []);

  return <SessionRevocationContext.Provider value={{ authVisit, busy, startRevocation }}>
    {children}
  </SessionRevocationContext.Provider>;
}

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
  const { authVisit, busy, startRevocation } = useContext(SessionRevocationContext);
  return <SessionRoster key={authVisit} busy={busy} startRevocation={startRevocation} />;
}

function SessionRoster({ busy, startRevocation }) {
  // The current-device flag belongs to the reader's authentication.
  const { data, loading, error, reload } = useApiResource(sessionsPath, { dedupe: false, label: 'sessions', logger });
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const [notice, setNotice] = useState(null);

  const sessions = data?.sessions ?? [];
  const revocable = data?.revocable !== false;
  const others = sessions.filter((row) => !row.current).length;

  const revoke = async (id, label) => {
    const result = startRevocation(id);
    if (!result) return;
    setNotice(null);
    try {
      await result;
      setNotice(id === 'others' ? 'Signed out everywhere else.' : `Signed out ${label}.`);
    } catch (err) {
      setNotice(err.message || 'Could not sign that device out.');
    }
  };

  let body;
  if (loading) body = <LoadingState label="sessions" rows={3} />;
  else if (error) body = <ErrorState error={error} onRetry={retry} label="Sessions" />;
  else body = (
    <SectionCard
      title="Signed-in devices"
      actions={revocable && others > 0 ? (
        <Button size="compact-xs" color="red" variant="light" loading={busy === 'others'} disabled={Boolean(busy)}
          onClick={() => revoke('others', 'every other device')}>
          Sign out {others} other{others === 1 ? '' : 's'}
        </Button>
      ) : null}
    >
      <Stack gap="xs">
        {!revocable ? (
          <StateMessage state="unavailable" title="Session management unavailable"
            detail="This deployment has no session store, so sessions cannot be listed or revoked." />
        ) : !sessions.length ? (
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

  return <section aria-label="Sessions" {...regionProps}>{body}</section>;
}
