// frontend/src/modules/Auto/FuelPanel.jsx
//
// Fill-ups: the log, the economy summary, and the fill-ups the CAR noticed but
// nobody logged. The form itself lives in FuelSheet.jsx.
//
// Detection watches the fuel GAUGE, not the map. A tank cannot refill itself,
// so a rise between trips is a purchase — no place needs naming, and it works
// at a station you'll never visit again. A known place only labels the result.

import { useState } from 'react';
import { Loading, Failed, Empty } from './AutoStates.jsx';
import { formatVolume, formatMoney, formatDistance, formatDay, litresToGallons } from './format.js';
import FuelSheet from './FuelSheet.jsx';

export default function FuelPanel({ vehicleId, fuel, loading, error, onReload }) {
  const [sheet, setSheet] = useState(null);

  if (loading) return <Loading label="Loading fill-ups" />;
  if (error) return <Failed error={error} onRetry={onReload} />;

  const logs = fuel?.logs || [];
  const summary = fuel?.summary;
  const detected = fuel?.detected || [];

  return (
    <div className="auto-panel">
      <button type="button" className="auto-btn auto-btn--primary auto-btn--block" onClick={() => setSheet({})}>
        Log a fill-up
      </button>

      {detected.length > 0 && (
        <section className="auto-card auto-card--attention">
          <h2 className="auto-card__label">
            The car noticed {detected.length === 1 ? 'a fill-up' : `${detected.length} fill-ups`}
          </h2>
          <ul className="auto-list">
            {detected.map((fill) => (
              <li key={fill.at} className="auto-detected">
                <div className="auto-detected__head">
                  <span className="auto-detected__day">{formatDay(fill.date)}</span>
                  <span className="auto-detected__rise">{fill.from_pct}% → {fill.to_pct}%</span>
                </div>
                <p className="auto-card__note">
                  {fill.place_label ? `At ${fill.place_label}. ` : ''}
                  {fill.estimated_volume_l != null
                    ? `About ${litresToGallons(fill.estimated_volume_l).toFixed(1)} gal.`
                    : 'Set tank_capacity_l in vehicles.yml for a volume estimate.'}
                  {!fill.filled_to_full && ' Gauge didn’t reach full, so this looks like a partial.'}
                </p>
                <button
                  type="button"
                  className="auto-btn auto-btn--primary"
                  onClick={() => setSheet({
                    date: fill.date,
                    placeId: fill.place_id,
                    placeLabel: fill.place_label,
                    volumeGal: fill.estimated_volume_l != null
                      ? litresToGallons(fill.estimated_volume_l).toFixed(2) : '',
                    partial: !fill.filled_to_full,
                  })}
                >
                  Log it
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary && !summary.needsMoreData && (
        <section className="auto-card">
          <h2 className="auto-card__label">Average</h2>
          <p className="auto-bignum">{summary.avgMpg} <span className="auto-bignum__unit">mpg</span></p>
          <p className="auto-card__note">
            Across {summary.intervals.length} full-tank interval{summary.intervals.length === 1 ? '' : 's'}
            {summary.totalSpend != null && ` · ${formatMoney(summary.totalSpend)} total`}
          </p>
        </section>
      )}

      {logs.length === 0 ? (
        <Empty
          title="No fill-ups logged"
          detail="Log one with the dash odometer and the app can start tracking mileage and mpg."
        />
      ) : (
        <ul className="auto-list">
          {logs.map((log) => (
            <li key={log.id} className="auto-record">
              <div className="auto-record__head">
                <span className="auto-record__title">{formatDay(log.date)}</span>
                <span className="auto-record__amount">{formatMoney(log.price_total)}</span>
              </div>
              <div className="auto-record__stats">
                <span>{formatVolume(log.volume_l)}</span>
                {log.odometer_km != null && <span>{formatDistance(log.odometer_km)}</span>}
                {log.partial && <span className="auto-tag">partial</span>}
                {!log.partial && log.odometer_km == null && (
                  <span className="auto-tag auto-tag--warn">no odometer</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sheet && (
        <FuelSheet
          vehicleId={vehicleId}
          initial={sheet}
          onClose={() => setSheet(null)}
          onSaved={() => { setSheet(null); onReload(); }}
        />
      )}
    </div>
  );
}
