import { useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('pending-card');
const findCallback = (messages, label) =>
  (messages?.[0]?.choices?.flat?.() || []).find((c) => c.text?.includes(label))?.callback_data || null;

/** Accept / Revise / Discard funnel for AI-parsed entries. */
export function PendingConfirmCard({ messages, onDone, onDiscard }) {
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (label, after) => {
    const callbackData = findCallback(messages, label);
    setBusy(true); setError(null);
    try {
      if (callbackData) await DaylightAPI('api/v1/health/nutrition/callback', { callbackData }, 'POST');
      logger.info('pending.action', { label });
      after();
    } catch (err) {
      logger.error('pending.action_failed', { label, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  const submitRevision = async () => {
    if (!revision.trim()) return;
    setBusy(true); setError(null);
    try {
      await DaylightAPI('api/v1/health/nutrition/input', { type: 'text', content: revision.trim() }, 'POST');
      onDone();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <div className="health-pending" role="status">
      {(messages || []).map((m, i) => <p key={i} className="health-pending__line">{m.text}</p>)}
      {error ? <p className="health-pending__error">{error.message} — input preserved, retry below.</p> : null}
      {revising ? (
        <div className="health-pending__actions">
          <TextInput size="xs" value={revision} onChange={(e) => setRevision(e.target.value)}
            placeholder="e.g. that was 2 slices, not 1" autoFocus style={{ flex: 1 }} />
          <Button size="xs" loading={busy} onClick={submitRevision}>Send</Button>
        </div>
      ) : (
        <div className="health-pending__actions">
          <Button size="xs" color="green" loading={busy} onClick={() => act('Accept', onDone)}>Accept</Button>
          <Button size="xs" variant="light" onClick={() => setRevising(true)}>Revise</Button>
          <Button size="xs" variant="subtle" color="red" onClick={() => act('Discard', onDiscard)}>Discard</Button>
        </div>
      )}
    </div>
  );
}
export default PendingConfirmCard;
