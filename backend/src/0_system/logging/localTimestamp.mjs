/**
 * Local wall-clock with an explicit UTC offset — `2026-08-22T15:00:58.668-07:00`.
 *
 * The house is self-hosted and single-timezone, so local time is what a human
 * reads off a log line. The OFFSET is what keeps the log store honest.
 *
 * Before this existed, `logger.mjs`, `dispatcher.mjs` and `ingestion.mjs` each
 * carried their own copy of "local time with the Z chopped off". VictoriaLogs
 * parses an offset-less ISO string as UTC, so every backend event was filed 7
 * hours early while frontend events — real UTC with `Z` — were filed correctly.
 * The two interleaved wrongly, and during the 2026-08-22 school session a
 * `_time:2h` query returned zero backend events while the backend was very much
 * running. Appending the true offset keeps the readable local clock and makes
 * the timestamp unambiguous to anything that parses it.
 *
 * @module system/logging/localTimestamp
 */

const PART_OPTIONS = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hour12: false,
};

/**
 * The zone's UTC offset AT THIS INSTANT, as `+HH:MM` / `-HH:MM`.
 * Derived per-call rather than cached so daylight saving is handled for free.
 */
function offsetFor(at, timeZone) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  // 'GMT-07:00' → '-07:00'. Plain 'GMT' (some runtimes, for UTC) → '+00:00'.
  const match = label.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? `${match[1]}${match[2]}:${match[3]}` : '+00:00';
}

/**
 * @param {Date} [at] instant to format (defaults to now)
 * @param {string|null} [timeZone] IANA zone; defaults to the system zone
 * @returns {string} e.g. `2026-08-22T15:00:58.668-07:00`
 */
export function formatLocalTimestamp(at = new Date(), timeZone = null) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, ...PART_OPTIONS })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`
    + `T${parts.hour}:${parts.minute}:${parts.second}.${parts.fractionalSecond}`
    + offsetFor(at, zone);
}

export default formatLocalTimestamp;
