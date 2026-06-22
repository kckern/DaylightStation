// backend/src/2_domains/ambient/timeParts.mjs
// Pure time helpers for the ambient scheduler. No I/O.

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** "HH:MM" → minutes since local midnight, or null if malformed. */
export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Resolve a Date into local-wall-clock parts for a timezone.
 * @returns {{dateStr:string, dow:number, minutes:number, iso:string}}
 */
export function resolveNowParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0; // some runtimes render midnight as 24
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dow: WEEKDAY[parts.weekday],
    minutes: hour * 60 + Number(parts.minute),
    iso: date.toISOString(),
  };
}

export default { parseHHMM, resolveNowParts };
