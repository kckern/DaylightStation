// backend/src/2_domains/automotive/services/ReminderService.mjs

/**
 * One list of what needs attention, regardless of what kind of thing it is.
 *
 * A registration renewal, an insurance expiry, and an oil change are the same
 * problem wearing three costumes: a date is approaching, and after it passes
 * something is wrong. Splitting them across a "documents" screen and a
 * "maintenance" screen means the household has to remember to check both, which
 * is precisely the job the app was supposed to take over.
 *
 * So service intervals and document expiries are normalised into one `Reminder`
 * shape and sorted together by due date.
 *
 * ## Only the latest record of each type establishes the next due date
 *
 * A recurrence is a property of the *most recent* occurrence. Three oil changes
 * in the history mean one upcoming oil change, not three — and it is due six
 * months after the newest, not after the oldest. Older records stay in the
 * history for their own sake and contribute nothing to the due list.
 *
 * @module automotive/services/ReminderService
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** How far ahead a reminder starts warning rather than sitting quiet. */
export const DEFAULT_DUE_SOON_DAYS = 30;

/**
 * @typedef {object} Reminder
 * @property {string} id
 * @property {'service'|'document'} kind
 * @property {string} label
 * @property {string} type          service type or document kind
 * @property {Date} dueDate
 * @property {number} daysUntilDue  negative when overdue
 * @property {'overdue'|'due-soon'|'ok'} status
 * @property {string|null} sourceId the record this was derived from
 */

/**
 * Build the due list.
 *
 * @param {object} input
 * @param {import('../entities/ServiceRecord.mjs').ServiceRecord[]} [input.serviceRecords]
 * @param {import('../entities/Document.mjs').Document[]} [input.documents]
 * @param {Date} input.asOf
 * @param {number} [input.dueSoonDays]
 * @returns {Reminder[]} soonest first, overdue at the top
 */
export function buildReminders({
  serviceRecords = [], documents = [], asOf, dueSoonDays = DEFAULT_DUE_SOON_DAYS,
}) {
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new TypeError('buildReminders requires an asOf Date');
  }
  const reminders = [];

  // One reminder per service TYPE, from that type's most recent record.
  const latestByType = new Map();
  for (const record of serviceRecords) {
    if (!record?.isRecurring) continue;
    const existing = latestByType.get(record.type);
    if (!existing || record.date > existing.date) latestByType.set(record.type, record);
  }

  for (const record of latestByType.values()) {
    const dueDate = record.nextDueDate;
    if (!dueDate) continue; // km-only interval; inert until mileage lands
    reminders.push(toReminder({
      id: `service:${record.type}`,
      kind: 'service',
      label: humanize(record.type),
      type: record.type,
      dueDate,
      sourceId: record.id,
      asOf,
      dueSoonDays,
    }));
  }

  for (const doc of documents) {
    if (!doc?.isExpiring) continue;
    reminders.push(toReminder({
      id: `document:${doc.id}`,
      kind: 'document',
      label: doc.label,
      type: doc.kind,
      dueDate: doc.expires,
      sourceId: doc.id,
      asOf,
      dueSoonDays,
    }));
  }

  return reminders.sort((a, b) => a.dueDate - b.dueDate);
}

function toReminder({ id, kind, label, type, dueDate, sourceId, asOf, dueSoonDays }) {
  // Whole days, floored from calendar midnight rather than from the current
  // instant: a renewal due "today" should read as 0 days all day, not tick over
  // to -1 at one minute past midnight and look overdue while it still isn't.
  const daysUntilDue = Math.floor((startOfDay(dueDate) - startOfDay(asOf)) / MS_PER_DAY);
  let status = 'ok';
  if (daysUntilDue < 0) status = 'overdue';
  else if (daysUntilDue <= dueSoonDays) status = 'due-soon';

  return { id, kind, label, type, dueDate, daysUntilDue, status, sourceId };
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** `oil-change` → `Oil change`. Presentation-adjacent, but the vocabulary is the domain's. */
function humanize(type) {
  const spaced = String(type).replace(/[-_]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
