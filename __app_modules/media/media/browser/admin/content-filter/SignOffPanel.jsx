import { useState } from 'react';
import { Button, Group, List, Select, Stack, Text } from '@mantine/core';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { createAppLogger } from '../../../../../../frontend/src/lib/ui/index.js';

/**
 * Approve the film for family use (parent certification): only when the machine bar holds, the
 * audit passed and is current, and every part is reviewed. No override (owner's ruling).
 * Also re-runs one pipeline stage for the film.
 */
const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const STAGES = [{ value: 'refine', label: 'Refine' }, { value: 'scenes', label: 'Scenes' }, { value: 'cards', label: 'Card drafts' }, { value: 'audit', label: 'Audit' }];

export function SignOffPanel({ ratingKey, signOff, onChanged = () => {}, busyText = null }) {
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(false);
  const [stage, setStage] = useState(null);
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
        <>
          <Button size="xs" disabled={disabled || !signOff?.ready} onClick={() => act('approve', `${base}/signoff`, {}, 'POST', 'Approved for family.')}>Approve for family</Button>
          {signOff?.missing?.length ? <List size="sm" spacing={2}>{signOff.missing.map((m) => <List.Item key={m}>{m}</List.Item>)}</List> : null}
        </>
      )}
      <Group gap="xs" align="flex-end" wrap="wrap">
        <Select size="xs" label="Stage again" placeholder="Pick a stage" data={STAGES} value={stage} onChange={setStage} disabled={disabled} />
        <Button size="compact-xs" variant="light" disabled={disabled || !stage} onClick={() => act('stage', `${base}/jobs`, { kind: 'stage', stage }, 'POST', 'Queued.')}>Run</Button>
      </Group>
      {notice ? <Text size="sm" role="status">{notice}</Text> : null}
    </Stack>
  );
}

export default SignOffPanel;
