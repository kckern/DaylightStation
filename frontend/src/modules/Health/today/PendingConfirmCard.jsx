import { useState } from 'react';
import { Button, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('pending-card');
/**
 * Resolve a button's callback by label. Captures are committed on arrival now, so
 * the server sends `↩️ Undo` / `✏️ Edit`; the legacy `Discard` / `Revise` labels stay
 * in the fallback list so an in-flight older response still resolves.
 */
const findCallback = (messages, labels) => {
  const buttons = messages?.[0]?.choices?.flat?.() || [];
  for (const label of labels) {
    const hit = buttons.find((c) => c.text?.includes(label))?.callback_data;
    if (hit) return hit;
  }
  return null;
};

/** Review card for an AI-parsed entry that is ALREADY logged (unsettled). */
export function PendingConfirmCard({ messages, onDone, onDiscard }) {
  const [revising, setRevising] = useState(false);
  const [revision, setRevision] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (labels, after) => {
    const callbackData = findCallback(messages, labels);
    if (!callbackData) {
      // Never close as though it worked — this action deletes a counting entry.
      logger.error('pending.action_unresolved', { labels });
      setError(new Error('That action is unavailable for this entry'));
      return;
    }
    setBusy(true); setError(null);
    try {
      await DaylightAPI('api/v1/health/nutrition/callback', { callbackData }, 'POST');
      logger.info('pending.action', { labels });
      after();
    } catch (err) {
      logger.error('pending.action_failed', { labels, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  const submitRevision = async () => {
    if (!revision.trim()) return;
    setBusy(true); setError(null);
    logger.info('revision.submit', {});
    try {
      await DaylightAPI('api/v1/health/nutrition/input', { type: 'text', content: revision.trim() }, 'POST');
      logger.info('revision.success', {});
      onDone();
    } catch (err) {
      logger.error('revision.failed', { error: err?.message });
      setError(err);
    } finally { setBusy(false); }
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
          {/* The entry is already logged — Done just dismisses, it confirms nothing. */}
          <Button size="xs" color="green" disabled={busy} onClick={onDone}>Done</Button>
          <Button size="xs" variant="light" disabled={busy} onClick={() => setRevising(true)}>Edit</Button>
          <Button size="xs" variant="subtle" color="red" loading={busy} disabled={busy} onClick={() => act(['Undo', 'Discard'], onDiscard)}>Undo</Button>
        </div>
      )}
    </div>
  );
}
export default PendingConfirmCard;
