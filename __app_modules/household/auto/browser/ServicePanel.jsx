// frontend/src/modules/Auto/ServicePanel.jsx
//
// Maintenance history and what's due.
//
// The interval field is what turns a record into a recurrence, and it is
// offered in MONTHS because that is what works today — mileage intervals need
// an odometer the car isn't yet giving up. The field for miles exists in the
// schema and is deliberately not on this form until it would do something.

import { useEffect, useRef, useState } from 'react';
import { localDateKey } from '@/lib/calendarDay.js';
import { LoadingState, ErrorState, EmptyState, Sheet, Select, useSheetSubmission } from '@/lib/ui';
import { AutoSheetActions } from './AutoSheetActions.jsx';
import { formatDay, formatMoney, formatDistance } from "./format.js";
import { autoApi } from "./useAutoApi.js";
import autoLog from "./autoLog.js";

/**
 * Fallback vocabulary for a successful response with no configured types.
 * The real list comes from the backend (`GET /service-types`), which the
 * household can extend in vehicles.yml without a frontend deploy.
 */
const FALLBACK_TYPES = [
  { value: 'oil-change', label: 'Oil change', defaultIntervalMonths: 6 },
  { value: 'other', label: 'Other', defaultIntervalMonths: null },
];

export default function ServicePanel({
  vehicleId, service, reminders, typeResource, loading, error, onReload,
}) {
  const [adding, setAdding] = useState(false);
  const close = () => setAdding(false);
  const serviceTypes = typeResource.data?.types;
  const types = serviceTypes?.length ? serviceTypes : FALLBACK_TYPES;

  const records = service?.records || [];
  const due = (reminders || []).filter((r) => r.kind === 'service');

  const content = loading ? <LoadingState label="service history" />
    : error ? <ErrorState error={error} onRetry={onReload} label="Service history" />
    : <div className="auto-panel">
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
    </div>;

  return (
    <>
      {content}
      {adding && (
        <Sheet open onClose={close} title="Log service">
          {typeResource.data
            ? <ServiceForm vehicleId={vehicleId} availableTypes={types} onClose={close} />
            : typeResource.error
              ? <ErrorState error={typeResource.error} label="Service types" onRetry={typeResource.reload} />
              : <LoadingState label="service types" />}
        </Sheet>
      )}
    </>
  );
}

// A record can name a type the current vocabulary no longer lists — an entry
// logged before a config edit. Fall back to humanising the raw value rather
// than rendering a blank label over real history.
const labelFor = (type, types) => types.find((t) => t.value === type)?.label
  || String(type).replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function serviceTypeFields(type) {
  return {
    type: type.value,
    intervalMonths: type.defaultIntervalMonths ? String(type.defaultIntervalMonths) : '',
    // Keep the mileage rule on the record even before an odometer is available.
    intervalKm: type.defaultIntervalKm ?? null,
  };
}

function ServiceForm({ vehicleId, availableTypes, onClose }) {
  // A form visit keeps the options it started with if configuration refreshes.
  const [types] = useState(availableTypes);
  const selectRef = useRef(null);
  const [form, setForm] = useState(() => ({
    ...serviceTypeFields(types[0]),
    date: localDateKey(),
    vendor: '',
    cost: '',
    odometerMi: '',
    notes: '',
  }));
  useEffect(() => {
    // The sheet stays mounted while a type read retries and replaces its button.
    if (document.activeElement === document.body) selectRef.current?.focus({ preventScroll: true });
  }, []);
  const { submit, saving, failure } = useSheetSubmission(onClose, error => {
    autoLog.warn('service.log_failed', { error: error?.message });
  });

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  // Picking a type pre-fills its usual interval — a nudge toward recording the
  // recurrence, which is what makes the due list work at all.
  const setType = (event) => {
    const type = event.target.value;
    const preset = types.find((option) => option.value === type);
    if (preset) setForm((f) => ({ ...f, ...serviceTypeFields(preset) }));
  };

  const save = async () => {
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
  };

  return (
    <form onSubmit={event => submit(event, save)} aria-label="Log service">
      <label className="auto-field">
        <span>What was done</span>
        <Select ref={selectRef} density="compact" className="ds-input" value={form.type} onChange={setType}>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </Select>
      </label>

      <div className="auto-field-row">
        <label className="auto-field">
          <span>Date</span>
          <input className="ds-input" type="date" value={form.date} onChange={set('date')} />
        </label>
        <label className="auto-field">
          <span>Cost ($)</span>
          <input
            className="ds-input" type="number" inputMode="decimal" step="0.01"
            value={form.cost} onChange={set('cost')}
          />
        </label>
      </div>

      <div className="auto-field-row">
        <label className="auto-field">
          <span>Odometer (mi)</span>
          <input
            className="ds-input" type="number" inputMode="decimal"
            value={form.odometerMi} onChange={set('odometerMi')} placeholder="optional"
          />
        </label>
        <label className="auto-field">
          <span>Repeat (months)</span>
          <input
            className="ds-input" type="number" inputMode="numeric"
            value={form.intervalMonths} onChange={set('intervalMonths')} placeholder="none"
          />
        </label>
      </div>

      <label className="auto-field">
        <span>Who did it</span>
        <input className="ds-input" value={form.vendor} onChange={set('vendor')} placeholder="optional" />
      </label>

      <label className="auto-field">
        <span>Notes</span>
        <textarea className="ds-input" rows={2} value={form.notes} onChange={set('notes')} />
      </label>

      <AutoSheetActions failure={failure} onCancel={onClose} saving={saving} />
    </form>
  );
}
