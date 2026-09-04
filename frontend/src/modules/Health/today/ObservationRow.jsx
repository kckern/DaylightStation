import { useState } from 'react';
import { Button } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('observation-row');

/**
 * Human sentence for one raw scale signal.
 *
 * Exported and pure so the wording is testable without rendering, and so the day view
 * and the edit sheet's Measurements list cannot describe the same row two ways.
 *
 * A `weight` reads as the measurement it is ("82 g on the kitchen scale"); the other
 * three kinds are scans, and are described by what was scanned rather than by a bare
 * number, because "3 on the kitchen scale" would read as a weight.
 */
export function observationLabel(o) {
  const at = typeof o?.at === 'string' && o.at.length >= 16 ? o.at.slice(11, 16) : null;
  const when = at ? ` at ${at}` : '';
  switch (o?.kind) {
    case 'weight':
      return `${o.value} ${o.unit || 'g'} on the kitchen scale${when}`;
    case 'density':
      return `Density level ${o.value} scanned${when}`;
    case 'container':
      return `Container "${o.value}" scanned${when}`;
    case 'upc':
      return `Barcode ${o.value} scanned${when}`;
    default:
      return `Scale signal${when}`;
  }
}

/**
 * One kitchen-scale observation, rendered compactly.
 *
 * Two presentations from one component:
 *  - the DAY list (default) — an unmatched signal with a Dismiss affordance. Dismissing
 *    is the only thing that resolves a row which aged out of the composition window, and
 *    an unresolved row is never archived, so this button is also what keeps the ledger's
 *    hot file (on the scale's own frame path) bounded.
 *  - the EDIT SHEET's Measurements list (`onPair` given) — the same sentence with a
 *    "pair to this entry" action instead.
 *
 * Both actions carry the row's own description in their accessible name: a screenful of
 * buttons all called "Dismiss" is unusable without sight of the row they sit on.
 */
export function ObservationRow({ observation, onDismissed, onPair, pairing = false, attached = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const label = observationLabel(observation);

  const dismiss = async () => {
    setBusy(true); setError(null);
    try {
      await DaylightAPI(`api/v1/health/nutrition/observations/${observation.id}/dismiss`, {}, 'POST');
      logger.info('observation.dismiss', { id: observation.id, kind: observation.kind });
      onDismissed?.(observation);
    } catch (err) {
      logger.error('observation.dismiss_failed', { id: observation.id, error: err?.message });
      setError(err);
    } finally { setBusy(false); }
  };

  return (
    <div className="health-obs__row">
      <span className="health-obs__label">{label}</span>
      {onPair ? null : <span className="health-obs__tag">Unmatched</span>}
      {error ? <p className="health-obs__error">{error.message} — try again.</p> : null}
      <div className="health-obs__actions">
        {onPair ? (
          <Button className="health-obs__btn" size="xs" variant="light"
            loading={pairing} disabled={pairing || attached}
            aria-label={`Pair ${label} to this entry`}
            onClick={() => onPair(observation)}>
            {attached ? 'Attached' : 'Pair to this entry'}
          </Button>
        ) : (
          <Button className="health-obs__btn" size="xs" variant="subtle"
            loading={busy} disabled={busy}
            aria-label={`Dismiss ${label}`}
            onClick={dismiss}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The day's unmatched scale signals, above the meal list. Entirely absent (not an empty
 * frame) when there are none — an unmatched observation is an occasional event, and a
 * permanent empty heading would be noise on every ordinary day.
 */
export function ObservationsSection({ observations, onChanged }) {
  if (!observations || observations.length === 0) return null;
  return (
    <section className="health-obs" aria-label="Unmatched scale measurements">
      <p className="health-obs__heading">ON THE SCALE</p>
      {observations.map((o) => (
        <ObservationRow key={o.id} observation={o} onDismissed={onChanged} />
      ))}
    </section>
  );
}

export default ObservationRow;
