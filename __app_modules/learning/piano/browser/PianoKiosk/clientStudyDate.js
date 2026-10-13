/**
 * The household study day, client-side.
 *
 * The agenda's day begins at 4am, so a 1am event belongs to the evening that
 * is still going on. This matches the backend's `studyDate(instant, tz, 4)`
 * boundary — and the study date the budget's day files are named for — without
 * importing a server module into the browser.
 *
 * Shared by the match gate and the budget meter deliberately: `studyDate` is
 * the field that lets one query pull a whole evening back out of the log
 * store, and two surfaces computing "today" with two different boundaries
 * would split that evening in half at midnight with nothing to show that it
 * had happened.
 */
export function clientStudyDate(now = new Date()) {
  const shifted = new Date(now.getTime() - 4 * 3_600_000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

export default clientStudyDate;
