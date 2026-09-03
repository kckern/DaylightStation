import { useState } from 'react';
import { Button } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('needs-review');

const SOURCE_LABEL = { telegram: 'Telegram', scale: 'Scale', web: 'Web' };

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const act = async (cmd) => {
    setBusy(true); setError(null);
    try {
      const callbackData = JSON.stringify({ cmd, id: entry.id });
      await DaylightAPI('api/v1/health/nutrition/callback', { callbackData }, 'POST');
      logger.info('needs-review.action', { cmd, id: entry.id, source: entry.source });
      onChanged();
    } catch (err) {
      logger.error('needs-review.action_failed', { cmd, id: entry.id, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <div className="health-pending__row">
      <div className="health-pending__row-info">
        <span className="health-pending__row-items">{itemsSummary(entry.items)}</span>
        <span className="health-pending__row-meta">
          {totalCalories(entry.items)} kcal
          <span className="health-pending__tag">{SOURCE_LABEL[entry.source] || entry.source}</span>
        </span>
      </div>
      {error ? <p className="health-pending__error">{error.message} — retry below.</p> : null}
      <div className="health-pending__actions">
        <Button size="xs" color="green" loading={busy} disabled={busy} onClick={() => act('a')}>Accept</Button>
        <Button size="xs" variant="subtle" color="red" loading={busy} disabled={busy} onClick={() => act('x')}>Discard</Button>
      </div>
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
