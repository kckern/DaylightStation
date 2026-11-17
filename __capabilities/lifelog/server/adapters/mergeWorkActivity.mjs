import { todoistExtractor } from './extractors/TodoistExtractor.mjs';
import { clickupExtractor } from './extractors/ClickupExtractor.mjs';
import moment from 'moment-timezone';
import { WorkExtractor } from './extractors/WorkExtractor.mjs';
const same = (legacy, event, provider, date, timezone) => {
  if (event.ref.provider !== provider || String(legacy.id ?? '') !== event.ref.id || legacy.accountId !== event.ref.accountId || legacy.action !== event.type) return false;
  if (legacy.occurrenceId != null && String(legacy.occurrenceId) === event.occurrenceId) return true;
  if (Number.isFinite(legacy.occurredAt)) return legacy.occurredAt === event.occurredAt;
  if (typeof legacy.time === 'string' && /^\d{2}:\d{2}$/.test(legacy.time)) return moment.tz(event.occurredAt, timezone).format('YYYY-MM-DD HH:mm') === date + ' ' + legacy.time;
  return false;
};
/** Exact identity and explicit time/occurrence only; titles cannot suppress history. */
export function mergeWorkActivity({
  legacyEntries,
  canonicalEvents,
  date,
  timezone
}) {
  const extractor = new WorkExtractor({
      timezone
    }),
    data = extractor.extractForDate(canonicalEvents, date),
    events = data?.events ?? [],
    entries = [];
  for (const original of legacyEntries) {
    if (!['todoist', 'clickup'].includes(original.source)) {
      entries.push(original);
      continue;
    }
    const entry = structuredClone(original),
      keep = row => events.filter(event => same(row, event, entry.source, date, timezone)).length !== 1,
      created = (entry.data.created ?? []).filter(keep),
      completed = (entry.data.completed ?? []).filter(keep);
    entry.data = {
      ...entry.data,
      created,
      completed,
      total: created.length + completed.length
    };
    if (entry.data.total) {
      entry.summary = (entry.source === 'todoist' ? todoistExtractor : clickupExtractor).summarize(entry.data);
      entries.push(entry);
    }
  }
  if (data) entries.push({
    source: 'work',
    category: extractor.category,
    data,
    summary: extractor.summarize(data)
  });
  return entries;
}
