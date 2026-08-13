// frontend/src/modules/Auto/FuelSheet.jsx
//
// The fill-up form, shared by the Fuel tab and by the drives timeline's
// "log this fill-up?" prompt.
//
// It lives in its own module precisely because of that second caller: the whole
// point of detecting a fuel stop is that the app already knows the date and the
// station, so the prompt opens this form with those filled in and leaves only
// volume and price to type. A duplicated form would drift from the canonical one.
//
// The odometer field is the quiet centre of the app. It is the only thing that
// can anchor mileage accumulation, and asking for it here — where the driver is
// already stopped at the pump with the dash lit — is why mileage works without
// inventing a separate chore.

import { useState } from 'react';
import { autoApi } from './useAutoApi.js';
import autoLog from './autoLog.js';

/**
 * @param {object} props
 * @param {string} props.vehicleId
 * @param {{date?: string, placeId?: string, placeLabel?: string, volumeGal?: string,
 *          partial?: boolean}} [props.initial] prefill from a detected fill-up
 */
export default function FuelSheet({ vehicleId, initial = {}, onClose, onSaved }) {
  const [form, setForm] = useState({
    date: initial.date || new Date().toISOString().slice(0, 10),
    odometerMi: '',
    // Estimated from the gauge rise when a tank capacity is configured. Left
    // editable rather than locked — the pump receipt is authoritative, and the
    // estimate is only there to save typing.
    volumeGal: initial.volumeGal || '',
    priceTotal: '',
    partial: Boolean(initial.partial),
  });
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(null);

  const set = (key) => (event) => setForm((f) => ({
    ...f,
    [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value,
  }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFailure(null);
    try {
      // Miles and gallons go out as-is; the backend converts once, at the
      // application edge. The wire never carries a mixed-unit payload.
      await autoApi.logFuel(vehicleId, {
        date: form.date,
        volumeGal: Number(form.volumeGal),
        odometerMi: form.odometerMi === '' ? undefined : Number(form.odometerMi),
        priceTotal: form.priceTotal === '' ? null : Number(form.priceTotal),
        placeId: initial.placeId || null,
        partial: form.partial,
      });
      autoLog.info('fuel.logged', {
        hasOdometer: form.odometerMi !== '',
        partial: form.partial,
        fromPrompt: Boolean(initial.placeId),
      });
      onSaved();
    } catch (err) {
      setFailure(err);
      autoLog.warn('fuel.log_failed', { error: err?.message });
    } finally {
      setSaving(false);
    }
  };

  const valid = Number(form.volumeGal) > 0;

  return (
    <div className="auto-sheet-backdrop" onClick={onClose} role="presentation">
      <form className="auto-sheet" onClick={(e) => e.stopPropagation()} onSubmit={submit} aria-label="Log a fill-up">
        <h2 className="auto-sheet__title">Log a fill-up</h2>
        {initial.placeLabel && (
          <p className="auto-field__note">At {initial.placeLabel}</p>
        )}
        {initial.volumeGal && (
          <p className="auto-field__note">
            Gallons estimated from the gauge — correct it from your receipt.
          </p>
        )}

        <label className="auto-field">
          <span>Date</span>
          <input className="auto-input" type="date" value={form.date} onChange={set('date')} />
        </label>

        <label className="auto-field">
          <span>Odometer (mi)</span>
          {/* inputMode numeric so phones show the number pad, not a full keyboard */}
          <input
            className="auto-input" type="number" inputMode="decimal" step="1"
            value={form.odometerMi} onChange={set('odometerMi')} placeholder="from the dash"
          />
          <span className="auto-field__note">Optional, but it’s what makes mileage and mpg work.</span>
        </label>

        <div className="auto-field-row">
          <label className="auto-field">
            <span>Gallons</span>
            <input
              className="auto-input" type="number" inputMode="decimal" step="0.001"
              value={form.volumeGal} onChange={set('volumeGal')} required
            />
          </label>
          <label className="auto-field">
            <span>Total ($)</span>
            <input
              className="auto-input" type="number" inputMode="decimal" step="0.01"
              value={form.priceTotal} onChange={set('priceTotal')}
            />
          </label>
        </div>

        <label className="auto-field auto-field--check">
          <input type="checkbox" checked={form.partial} onChange={set('partial')} />
          <span>Partial fill (didn’t fill the tank)</span>
        </label>
        {form.partial && (
          <p className="auto-field__note">
            Partial fills still count toward spend, but can’t close an mpg interval —
            economy needs a full tank at both ends.
          </p>
        )}

        {failure && <p className="auto-field__error">{failure.message}</p>}

        <div className="auto-sheet__actions">
          <button type="button" className="auto-btn auto-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="auto-btn auto-btn--primary" disabled={saving || !valid}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
