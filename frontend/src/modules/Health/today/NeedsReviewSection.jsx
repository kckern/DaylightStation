import { useRef, useState } from 'react';
import { Button } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
import { PendingReviewEditor } from './PendingReviewEditor.jsx';

const logger = createAppLogger('health').child('needs-review');

const SOURCE_LABEL = { telegram: 'Telegram', scale: 'Scale', web: 'Web', scanner: 'Scanner' };

/** Sum of a pending log's item calories, rounded for display. */
function totalCalories(items) {
  return Math.round((items || []).reduce((sum, it) => sum + (Number(it.calories) || 0), 0));
}

/** "Apple, Peanut Butter" — items summary, no calorie noise (kcal shown separately). */
function itemsSummary(items) {
  return (items || []).map((it) => it.label).filter(Boolean).join(', ') || 'Unlabeled item';
}

/**
 * One pending NutriLog awaiting Accept/Discard — created off-surface
 * (Telegram, the scale bridge, a failed AI call) and otherwise invisible in
 * the web Today view until acted on. Root-cause fix, live incident 2026-09-02.
 */
function NeedsReviewRow({ entry, onChanged }) {
  const [reviewing, setReviewing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const discardOperation = useRef(null);

  const discard = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (!discardOperation.current) discardOperation.current = crypto.randomUUID();
      await DaylightAPI(`api/v1/health/nutrition/pending/${entry.id}/review`,
        { action: 'discard', expectedVersion: entry.version, operationId: discardOperation.current }, 'POST');
      logger.info('needs-review.action', { action: 'discard', id: entry.id, source: entry.source });
      onChanged();
    } catch (err) {
      logger.error('needs-review.action_failed', { action: 'discard', id: entry.id, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <div className="health-pending__row">
      <div className="health-pending__row-info">
        <span className="health-pending__row-items">{itemsSummary(entry.items)}</span>
        <span className="health-pending__row-meta">
          {entry.nutritionLookup?.missing?.includes('calories') ? 'Calories need review' : `${totalCalories(entry.items)} kcal`}
          <span className="health-pending__tag">{entry.captureMethod === 'upc' ? 'Barcode' : SOURCE_LABEL[entry.source] || entry.source}</span>
        </span>
      </div>
      {error ? <p className="health-pending__error">{error.message} — retry below.</p> : null}
      <div className="health-pending__actions">
        <Button size="xs" loading={busy} disabled={busy} onClick={() => setReviewing(entry)}>Review food</Button>
        <Button size="xs" variant="subtle" color="red" loading={busy} disabled={busy} onClick={discard}>Discard</Button>
      </div>
      {reviewing ? <PendingReviewEditor entry={reviewing} onClose={() => setReviewing(null)} onChanged={onChanged} /> : null}
    </div>
  );
}

/**
 * NEEDS REVIEW section — pending NutriLogs for the viewed date, from any
 * surface. Rendered above BREAKFAST when non-empty; entirely absent (not
 * just empty) otherwise, matching `.health-pending`'s occasional-banner feel.
 */
export function NeedsReviewSection({ pending, onChanged }) {
  if (!pending || pending.length === 0) return null;
  return (
    <div className="health-pending health-pending--needs-review" role="status">
      <p className="health-pending__heading">NEEDS REVIEW</p>
      {pending.map((entry) => (
        <NeedsReviewRow key={entry.id} entry={entry} onChanged={onChanged} />
      ))}
    </div>
  );
}
export default NeedsReviewSection;
