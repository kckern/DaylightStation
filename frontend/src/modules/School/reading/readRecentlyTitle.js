const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * TV wording for a book refused because the child finished it lately
 * (`book-refused` `reason: 'read-recently'`). `lastReadOn` and `today` are
 * study-day keys (YYYY-MM-DD); the weekday is read off the key itself, in UTC,
 * so no timezone can shift it.
 */
export function readRecentlyTitle(lastReadOn, today) {
  if (lastReadOn && lastReadOn === today) return 'You read this earlier today.';
  const t = typeof lastReadOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(lastReadOn) ? Date.parse(`${lastReadOn}T00:00:00Z`) : NaN;
  if (!Number.isFinite(t)) return 'You read this one lately.';
  return `You read this on ${WEEKDAYS[new Date(t).getUTCDay()]}.`;
}

export default readRecentlyTitle;
