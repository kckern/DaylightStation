// frontend/src/modules/Auto/ServicePanel.jsx
//
// Maintenance history and what's due.
//
// The interval field is what turns a record into a recurrence, and it is
// offered in MONTHS because that is what works today — mileage intervals need
// an odometer the car isn't yet giving up. The field for miles exists in the
// schema and is deliberately not on this form until it would do something.

import { useState } from 'react';
import { LoadingState, ErrorState, EmptyState, Sheet } from '@/lib/ui';
import { formatDay, formatMoney, formatDistance } from './format.js';
import { autoApi } from './useAutoApi.js';
import autoLog from './autoLog.js';

/**
 * Fallback vocabulary, used only if the config-driven list hasn't arrived.
 * The real list comes from the backend (`GET /service-types`), which the
 * household can extend in vehicles.yml without a frontend deploy.
 */
const FALLBACK_TYPES = [
  { value: 'oil-change', label: 'Oil change', defaultIntervalMonths: 6 },
  { value: 'other', label: 'Other', defaultIntervalMonths: null },
];

export default function ServicePanel({
  vehicleId, service, reminders, serviceTypes, loading, error, onReload,
}) {
  const [adding, setAdding] = useState(false);
  const types = serviceTypes?.length ? serviceTypes : FALLBACK_TYPES;

  if (loading) return <LoadingState label="service history" />;
  if (error) return <ErrorState error={error} onRetry={onReload} label="Service history" />;

  const records = service?.records || [];
  const due = (reminders || []).filter((r) => r.kind === 'service');

  return (
    <div className="auto-panel">
      <button type="button" className="auto-btn auto-btn--primary auto-btn--block" onClick={() => setAdding(true)}>
        Log service
      </button>

      {due.length > 0 && (
        <section className="auto-card">
          <h2 className="auto-card__label">Coming up</h2>
          <ul className="auto-list">
            {due.map((reminder) => (
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

      {records.length === 0 ? (
        <EmptyState
          title="No service records"
          hint="Log what's been done and the app can tell you when the next one is due."
        />
      ) : (
        <ul className="auto-list">
          {records.map((record) => (
            <li key={record.id} className="auto-record">
              <div className="auto-record__head">
                <span className="auto-record__title">{labelFor(record.type, types)}</span>
                <span className="auto-record__amount">{formatMoney(record.cost)}</span>
              </div>
              <div className="auto-record__stats">
                <span>{formatDay(record.date)}</span>
                {record.vendor && <span>{record.vendor}</span>}
                {record.odometer_km != null && <span>{formatDistance(record.odometer_km)}</span>}
                {record.interval_months && <span className="auto-tag">every {record.interval_months}mo</span>}
              </div>
              {record.notes && <p className="auto-record__notes">{record.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <ServiceSheet
          vehicleId={vehicleId}
          types={types}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); onReload(); }}
        />
      )}
    </div>
  );
}

// A record can name a type the current vocabulary no longer lists — an entry
// logged before a config edit. Fall back to humanising the raw value rather
// than rendering a blank label over real history.
const labelFor = (type, types) => types.find((t) => t.value === type)?.label
  || String(type).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function ServiceSheet({ vehicleId, types, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    type: types[0]?.value || 'other',
    vendor: '',
    cost: '',
    odometerMi: '',
    intervalMonths: '6',
    intervalKm: null,
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  // Picking a type pre-fills its usual interval — a nudge toward recording the
  // recurrence, which is what makes the due list work at all.
  const setType = (event) => {
    const type = event.target.value;
    const preset = types.find((t) => t.value === type);
    setForm((f) => ({
      ...f, type,
      intervalMonths: preset?.defaultIntervalMonths ? String(preset.defaultIntervalMonths) : '',
      // Stored with the record so the mileage rule is ready the day the
      // odometer works; nothing displays it yet.
      intervalKm: preset?.defaultIntervalKm || null,
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      await autoApi.logService(vehicleId, {
        date: form.date,
        type: form.type,
        vendor: form.vendor || null,
        cost: form.cost === '' ? null : Number(form.cost),
        odometerMi: form.odometerMi === '' ? undefined : Number(form.odometerMi),
        intervalMonths: form.intervalMonths === '' ? null : Number(form.intervalMonths),
        intervalKm: form.intervalKm || null,
        notes: form.notes,
      });
      autoLog.info('service.logged', { type: form.type, recurring: form.intervalMonths !== '' });
      onSaved();
    } catch (err) {
      setFailure(err);
      autoLog.warn('service.log_failed', { error: err?.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Log service">
      <form onSubmit={submit} aria-label="Log service">
        <label className="auto-field">
          <span>What was done</span>
          <select className="auto-input" value={form.type} onChange={setType}>
            {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>

        <div className="auto-field-row">
          <label className="auto-field">
            <span>Date</span>
            <input className="auto-input" type="date" value={form.date} onChange={set('date')} />
          </label>
          <label className="auto-field">
            <span>Cost ($)</span>
            <input
              className="auto-input" type="number" inputMode="decimal" step="0.01"
              value={form.cost} onChange={set('cost')}
            />
          </label>
        </div>

        <div className="auto-field-row">
          <label className="auto-field">
            <span>Odometer (mi)</span>
            <input
              className="auto-input" type="number" inputMode="decimal"
              value={form.odometerMi} onChange={set('odometerMi')} placeholder="optional"
            />
          </label>
          <label className="auto-field">
            <span>Repeat (months)</span>
            <input
              className="auto-input" type="number" inputMode="numeric"
              value={form.intervalMonths} onChange={set('intervalMonths')} placeholder="none"
            />
          </label>
        </div>

        <label className="auto-field">
          <span>Who did it</span>
          <input className="auto-input" value={form.vendor} onChange={set('vendor')} placeholder="optional" />
        </label>

        <label className="auto-field">
          <span>Notes</span>
          <textarea className="auto-input" rows={2} value={form.notes} onChange={set('notes')} />
        </label>

        {failure && <p className="auto-field__error">{failure.message}</p>}

        <div className="auto-sheet__actions">
          <button type="button" className="auto-btn auto-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="auto-btn auto-btn--primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
