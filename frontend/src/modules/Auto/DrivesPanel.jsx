// frontend/src/modules/Auto/DrivesPanel.jsx
//
// The journey timeline. Each row is one outing, not one ignition cycle.
//
// Unnamed endpoints are the growth mechanism for the place registry: the row
// offers to name them, and naming one improves every past and future journey
// that touched the same spot. That is why an unresolved stop shows an action
// rather than a coordinate — a lat/lon tells the reader nothing, but the button
// beside it is worth tapping.

import { useState } from 'react';
import { LoadingState, ErrorState, EmptyState, Sheet } from '@/lib/ui';
import { formatDistance, formatDuration, formatDay, formatTime, formatSpeed } from './format.js';
import { autoApi } from './useAutoApi.js';
import FuelSheet from './FuelSheet.jsx';
import autoLog from './autoLog.js';

const PLACE_KINDS = ['home', 'school', 'church', 'work', 'fuel', 'store', 'service', 'other'];

export default function DrivesPanel({
  vehicleId, journeys, hidden, fuelLogs, loading, error, onReload, onFuelLogged,
  includeShuffles, onToggleShuffles,
}) {
  const [naming, setNaming] = useState(null);
  const [fueling, setFueling] = useState(null);

  if (loading) return <LoadingState label="drives" />;
  if (error) return <ErrorState error={error} onRetry={onReload} label="Drives" />;

  const rows = journeys || [];

  return (
    <div className="auto-panel">
      {rows.length === 0 ? (
        <EmptyState
          title="No drives yet"
          hint={
            hidden > 0
              ? `${hidden} very short recording${hidden === 1 ? '' : 's'} hidden — the car moving in the garage, or the ignition blipping.`
              : 'Trips upload when the car gets home and joins WiFi.'
          }
        />
      ) : (
        <ul className="auto-list auto-list--journeys">
          {rows.map((journey) => (
            <JourneyRow
              key={journey.id}
              journey={journey}
              onName={setNaming}
              onLogFuel={setFueling}
              fuelPrompt={pendingFuelStop(journey, fuelLogs)}
            />
          ))}
        </ul>
      )}

      {(hidden > 0 || includeShuffles) && (
        <button type="button" className="auto-btn auto-btn--ghost auto-shuffle-toggle" onClick={onToggleShuffles}>
          {includeShuffles
            ? 'Hide very short recordings'
            : `Show ${hidden} very short recording${hidden === 1 ? '' : 's'}`}
        </button>
      )}

      {fueling && (
        <FuelSheet
          vehicleId={vehicleId}
          initial={fueling}
          onClose={() => setFueling(null)}
          onSaved={() => { setFueling(null); onFuelLogged?.(); }}
        />
      )}

      {naming && (
        <NamePlaceSheet
          point={naming}
          onClose={() => setNaming(null)}
          onSaved={() => { setNaming(null); onReload(); }}
        />
      )}
    </div>
  );
}

/**
 * Why a row looks thinner than expected, in one sentence.
 *
 * Both conditions are the norm rather than the exception until the ECU link is
 * fixed, so they are joined instead of stacked — a reader scanning the timeline
 * should see the distances, with the explanation available underneath, not a
 * paragraph of caveats with the numbers hiding above it.
 */
function caveats(journey) {
  const parts = [];
  if (!journey.has_ecu) parts.push('no engine data');
  if (!journey.clock_recoverable) parts.push('no clock, so it can’t be dated');
  if (!parts.length) return null;
  return `Recorded with ${parts.join(' and ')}.`;
}

/**
 * A fuel stop on this journey that has no matching fill-up logged yet.
 *
 * This is the payoff for stitching journeys and naming places: the app already
 * knows the date and the station, so it can ask you to confirm rather than
 * asking you to remember. Wainwright can only do the latter.
 *
 * Matching is by DAY plus place, with a one-day tolerance either side. The
 * tolerance is not slop — a fill-up late at night can be logged the next
 * morning, and a journey with no recoverable clock is dated by arrival, which
 * can land a day off the drive itself. Prompting for a fill-up already recorded
 * is the one failure mode that would make this feature actively annoying, so it
 * errs toward staying quiet.
 *
 * Returns null when there is nothing to ask about.
 */
function pendingFuelStop(journey, fuelLogs) {
  if (!journey.has_fuel_stop) return null;
  const stop = [journey.origin, ...journey.stops, journey.destination]
    .find((point) => point?.is_fuel_stop);
  if (!stop) return null;

  const when = stop.arrived_at || journey.started_at || journey.ended_at;
  if (!when) return null;
  const day = when.slice(0, 10);

  const alreadyLogged = (fuelLogs || []).some((log) => {
    if (log.place && stop.place_id && log.place !== stop.place_id) return false;
    return Math.abs(daysBetween(log.date, day)) <= 1;
  });
  if (alreadyLogged) return null;

  return { date: day, placeId: stop.place_id, placeLabel: stop.label };
}

const daysBetween = (a, b) =>
  Math.round((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);

function JourneyRow({ journey, onName, onLogFuel, fuelPrompt }) {
  const unnamed = [journey.origin, ...journey.stops, journey.destination]
    .filter((p) => p && p.fix && !p.place_id);

  return (
    <li className={`auto-journey${journey.classification === 'shuffle' ? ' auto-journey--shuffle' : ''}`}>
      <div className="auto-journey__head">
        <span className="auto-journey__day">
          {journey.clock_recoverable ? formatDay(journey.started_at) : 'Time unknown'}
        </span>
        {journey.clock_recoverable && formatTime(journey.started_at) && (
          <span className="auto-journey__time">{formatTime(journey.started_at)}</span>
        )}
      </div>

      <p className="auto-journey__title">{journey.title || 'Route not recorded'}</p>

      <div className="auto-journey__stats">
        <span>{formatDistance(journey.distance_km)}</span>
        <span>{formatDuration(journey.driving_s)} driving</span>
        {journey.max_speed_kph != null && <span>max {formatSpeed(journey.max_speed_kph)}</span>}
        {/* Keyed on stop_count, NOT leg_count: sub-minute leg boundaries are
            recorder artifacts and get suppressed, so a four-leg journey can
            legitimately have zero stops — and "0 stops" is noise, not news. */}
        {journey.stop_count > 0 && <span>{journey.stop_count} stop{journey.stop_count === 1 ? '' : 's'}</span>}
        {journey.harsh_events?.length > 0 && (
          <span className="auto-journey__harsh">
            {journey.harsh_events.length} harsh
            {' '}({Math.max(...journey.harsh_events.map((e) => e.g || 0)).toFixed(2)}g)
          </span>
        )}
      </div>

      {/* One line, not a stack. Both caveats apply to almost every row right
          now, and three italic sentences per card buries the data they annotate. */}
      {caveats(journey) && <p className="auto-journey__note">{caveats(journey)}</p>}

      <div className="auto-journey__actions">
        {fuelPrompt && (
          <button
            type="button"
            className="auto-btn auto-btn--primary auto-journey__name"
            onClick={() => onLogFuel(fuelPrompt)}
          >
            Log the fill-up
          </button>
        )}
        {unnamed.length > 0 && (
          <button
            type="button"
            className="auto-btn auto-btn--ghost auto-journey__name"
            onClick={() => onName(unnamed[0])}
          >
            Name this place
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Bottom sheet for naming a place.
 *
 * A sheet rather than a dialog because this is a phone-first flow reached with
 * a thumb: it rises from the bottom, where the thumb already is, instead of
 * appearing in the middle where the reach is worst.
 */
function NamePlaceSheet({ point, onClose, onSaved }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('other');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    setFailure(null);
    try {
      await autoApi.namePlace({ label: label.trim(), kind, lat: point.fix.lat, lon: point.fix.lon });
      autoLog.info('place.named', { kind });
      onSaved();
    } catch (err) {
      setFailure(err);
      autoLog.warn('place.name_failed', { error: err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Name this place">
      <form onSubmit={submit} aria-label="Name this place">
        <label className="auto-field">
          <span>What is it?</span>
          <input
            className="auto-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Costco Gas"
            autoFocus
          />
        </label>
        <label className="auto-field">
          <span>Kind</span>
          <select className="auto-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {PLACE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        {kind === 'fuel' && (
          <p className="auto-field__note">
            Marking this a fuel stop lets the app spot fill-ups on the timeline.
          </p>
        )}
        {failure && <p className="auto-field__error">{failure.message}</p>}
        <div className="auto-sheet__actions">
          <button type="button" className="auto-btn auto-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="auto-btn auto-btn--primary" disabled={saving || !label.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
