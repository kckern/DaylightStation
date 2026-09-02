// frontend/src/modules/Auto/OverviewPanel.jsx
//
// The vehicle's home screen. Everything here is a number the app is willing to
// stand behind, or an explicit statement that it doesn't have one.

import { LoadingState, ErrorState } from '@/lib/ui';
import {
  formatDistance, formatDay, formatTime, formatMoney, describeOdometerSource,
} from './format.js';

export default function OverviewPanel({ overview, loading, error, onReload, onGoTo, vehicleDescription }) {
  if (loading) return <LoadingState label="vehicle" />;
  if (error) return <ErrorState error={error} onRetry={onReload} label="Vehicle" />;
  if (!overview) return null;

  const { odometer, last_snapshot: snap, fuel, reminders, recorded_distance_km: recorded } = overview;
  const attention = (reminders || []).filter((r) => r.status !== 'ok');

  return (
    <div className="auto-panel">
      {vehicleDescription && (
        <p className="auto-identity">{vehicleDescription}</p>
      )}

      <section className="auto-card auto-card--odometer">
        <h2 className="auto-card__label">Odometer</h2>
        {odometer.km === null ? (
          <>
            <p className="auto-bignum auto-bignum--muted">Not set</p>
            <p className="auto-card__note">{describeOdometerSource(odometer.source, odometer.confidence)}</p>
            <button type="button" className="auto-btn auto-btn--primary" onClick={() => onGoTo?.('fuel')}>
              Log a fill-up
            </button>
          </>
        ) : (
          <>
            <p className="auto-bignum">{formatDistance(odometer.km)}</p>
            <p className="auto-card__note">
              {describeOdometerSource(odometer.source, odometer.confidence)}
              {odometer.confidence === 'degraded' && (
                <> · {odometer.unmeasured_spans} unmeasured gap{odometer.unmeasured_spans === 1 ? '' : 's'}</>
              )}
            </p>
          </>
        )}
      </section>

      {attention.length > 0 && (
        <section className="auto-card auto-card--attention">
          <h2 className="auto-card__label">Needs attention</h2>
          <ul className="auto-list">
            {attention.map((reminder) => (
              <li key={reminder.id} className={`auto-reminder auto-reminder--${reminder.status}`}>
                <span className="auto-reminder__label">{reminder.label}</span>
                <span className="auto-reminder__when">
                  {reminder.daysUntilDue < 0
                    ? `${Math.abs(reminder.daysUntilDue)}d overdue`
                    : `in ${reminder.daysUntilDue}d`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="auto-card">
        <h2 className="auto-card__label">Last reported</h2>
        {overview.last_seen ? (
          <>
            <p className="auto-card__value">
              {formatDay(overview.last_seen)}
              {formatTime(overview.last_seen) ? ` · ${formatTime(overview.last_seen)}` : ''}
            </p>
            <dl className="auto-stats">
              <Stat label="Battery" value={snap?.battery_v ? `${snap.battery_v.toFixed(2)} V` : '—'} />
              <Stat label="Fuel" value={snap?.fuel_pct != null ? `${snap.fuel_pct}%` : 'No reading'} />
              <Stat label="Codes" value={snap?.dtc?.length ? snap.dtc.join(', ') : 'None'} />
            </dl>
            {/* The relay only reaches the bus on home WiFi, so a stale figure
                means the car is out, not that anything is broken. */}
            {snap?.fuel_pct == null && (
              <p className="auto-card__note">
                Fuel level needs the engine bus, which hasn’t answered on recent trips.
              </p>
            )}
          </>
        ) : (
          <p className="auto-card__value auto-card__value--muted">Nothing reported yet</p>
        )}
      </section>

      <section className="auto-card">
        <h2 className="auto-card__label">Fuel economy</h2>
        {fuel?.needsMoreData ? (
          <>
            <p className="auto-card__value auto-card__value--muted">
              {fuel.fillCount === 0 ? 'No fill-ups logged' : 'Needs another full tank'}
            </p>
            <p className="auto-card__note">
              Economy is measured between two full tanks — that’s the only span where
              the fuel burned is actually known.
            </p>
          </>
        ) : (
          <>
            <p className="auto-bignum">{fuel.avgMpg} <span className="auto-bignum__unit">mpg</span></p>
            <dl className="auto-stats">
              <Stat label="Best" value={`${fuel.bestMpg} mpg`} />
              <Stat label="Worst" value={`${fuel.worstMpg} mpg`} />
              <Stat label="Spend" value={formatMoney(fuel.totalSpend)} />
            </dl>
          </>
        )}
      </section>

      <section className="auto-card">
        <h2 className="auto-card__label">Recorded by the device</h2>
        <p className="auto-card__value">{formatDistance(recorded)} over {overview.trip_count} trips</p>
        <p className="auto-card__note">
          Distance the in-car device actually logged. Not the odometer — it starts
          when the device was fitted and misses whatever it slept through.
        </p>
      </section>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="auto-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
