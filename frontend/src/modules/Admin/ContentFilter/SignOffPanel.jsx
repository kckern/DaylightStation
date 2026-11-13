import { useState } from 'react';
import { Button, Group, List, Stack, Text } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/index.js';

/**
 * What still stands between the film and family approval, and Withdraw once approved. Approving
 * itself is the film status card's button (FilmStatusCard.jsx), shown when nothing is missing.
 * No pipeline stage is offered here (2026-11-12: the "Stage again" dropdown is gone).
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';

export function SignOffPanel({ ratingKey, signOff, onChanged = () => {}, busyText = null }) {
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(false);
  const base = `${API}/${encodeURIComponent(ratingKey)}`;
  const act = async (key, path, body, method, done) => {
    setPending(true); setNotice(null);
    try { await DaylightAPI(path, body, method); logger.info('signoff.action', { ratingKey, key }); if (done) setNotice(done); onChanged(); } catch (err) {
      logger.warn('signoff.action_failed', { ratingKey, key, error: err.message });
      setNotice(err.message || 'That did not work.');
    } finally { setPending(false); }
  };
  const disabled = pending || Boolean(busyText);
  return (
    <Stack gap="xs" className="cf-signoff">
      {signOff?.parent ? (
        <Group gap="xs" wrap="wrap">
          <Text size="sm">Approved for family by {signOff.parent.by}.</Text>
          <Button size="compact-xs" variant="subtle" color="red" disabled={disabled} onClick={() => act('withdraw', `${base}/signoff`, {}, 'DELETE', 'Approval withdrawn.')}>Withdraw approval</Button>
        </Group>
      ) : (
        signOff?.missing?.length ? <List size="sm" spacing={2}>{signOff.missing.map((m) => <List.Item key={m}>{m}</List.Item>)}</List> : null
      )}
      {notice ? <Text size="sm" role="status">{notice}</Text> : null}
    </Stack>
  );
}

export default SignOffPanel;
