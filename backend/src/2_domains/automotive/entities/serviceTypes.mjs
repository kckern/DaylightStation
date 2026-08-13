// backend/src/2_domains/automotive/entities/serviceTypes.mjs

/**
 * The maintenance vocabulary.
 *
 * A curated list rather than free text, because due-tracking groups records by
 * `type`: with free entry, "oil change" and "Oil Change" become two separate
 * recurrences and the due list quietly doubles. `other` is the escape hatch so
 * nothing has to be forced into a category that does not fit.
 *
 * `defaultIntervalMonths` pre-fills the recurrence when a type is picked. That
 * nudge matters more than it looks: a record with no interval produces no
 * reminder, so the difference between a log and a working due list is whether
 * this field gets filled in.
 *
 * Types with a `null` interval are genuinely condition-based — tires and brakes
 * wear out on distance and driving style, not on a calendar — and get no
 * reminder until mileage intervals are usable.
 *
 * This is the DEFAULT set. The household can override or extend it in
 * `config/vehicles.yml` under `service_types:` without a deploy; see
 * `AutomotiveContainer#serviceTypes`.
 *
 * @module automotive/entities/serviceTypes
 */

export const DEFAULT_SERVICE_TYPES = Object.freeze([
  { value: 'oil-change', label: 'Oil change', defaultIntervalMonths: 6, defaultIntervalKm: null },
  { value: 'tire-rotation', label: 'Tire rotation', defaultIntervalMonths: 6 },
  { value: 'tires', label: 'Tires', defaultIntervalMonths: null },
  { value: 'brakes', label: 'Brakes', defaultIntervalMonths: null },
  { value: 'battery', label: 'Battery', defaultIntervalMonths: null },
  { value: 'air-filter', label: 'Air filter', defaultIntervalMonths: 12 },
  { value: 'cabin-filter', label: 'Cabin filter', defaultIntervalMonths: 12 },
  { value: 'wipers', label: 'Wipers', defaultIntervalMonths: 12 },
  { value: 'coolant', label: 'Coolant', defaultIntervalMonths: 24 },
  { value: 'transmission', label: 'Transmission', defaultIntervalMonths: null },
  { value: 'registration', label: 'Registration', defaultIntervalMonths: 12 },
  { value: 'insurance', label: 'Insurance', defaultIntervalMonths: 6 },
  { value: 'inspection', label: 'Inspection', defaultIntervalMonths: 12 },
  { value: 'repair', label: 'Repair', defaultIntervalMonths: null },
  { value: 'other', label: 'Other', defaultIntervalMonths: null },
]);

/**
 * Normalise a configured list, dropping malformed rows.
 *
 * A household override is hand-edited YAML, so a row missing its `value` is a
 * likely typo. Dropping it individually keeps the rest of the list working
 * rather than falling back wholesale to the defaults and leaving the author
 * wondering why none of their edits took effect.
 *
 * @param {Array<object>|null|undefined} configured
 * @returns {Array<{value: string, label: string, defaultIntervalMonths: number|null, defaultIntervalKm: number|null}>}
 */
export function resolveServiceTypes(configured) {
  if (!Array.isArray(configured) || configured.length === 0) return [...DEFAULT_SERVICE_TYPES];

  const resolved = [];
  for (const row of configured) {
    const value = typeof row?.value === 'string' ? row.value.trim() : '';
    if (!value) continue;
    const months = Number(row.default_interval_months ?? row.defaultIntervalMonths);
    const km = Number(row.default_interval_km ?? row.defaultIntervalKm);
    resolved.push({
      value,
      label: row.label || humanize(value),
      defaultIntervalMonths: Number.isFinite(months) && months > 0 ? months : null,
      // Carried and stored, but INERT for reminders until the odometer works —
      // ReminderService skips km-only intervals rather than pretending. Kept so
      // records entered today already hold what the mileage rule will need.
      defaultIntervalKm: Number.isFinite(km) && km > 0 ? km : null,
    });
  }
  return resolved.length ? resolved : [...DEFAULT_SERVICE_TYPES];
}

/** `oil-change` → `Oil change`. */
export function humanize(type) {
  const spaced = String(type).replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
