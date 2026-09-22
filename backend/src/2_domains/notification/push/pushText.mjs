/**
 * Shared text rules for household push notifications
 * (docs/reference/notifications/push-standard.md).
 *
 * A push is read on a lock screen by a person who did not write the code.
 * Every producer composes through these helpers so that the same mistakes
 * (raw ids, UTC timestamps, `None`) cannot come back one producer at a time.
 * Pure: no clock, no I/O.
 */

const text = (value) => (typeof value === 'string' && value.trim()
  ? value.trim().replace(/\s+/g, ' ')
  : null);

/** 'living_room' → 'Living Room'. A last resort; a configured name always wins. */
export function titleCaseId(id) {
  const raw = text(id);
  if (!raw) return null;
  return raw.split(/[-_\s]+/).filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/** A person's name as the household wrote it (`profile.yml` `display_name`). */
export function personDisplayName(profile, id) {
  return text(profile?.display_name) ?? text(profile?.name) ?? titleCaseId(id);
}

/** '2026-08-28T01:13:29Z' → '6:13 PM' in the household's zone. */
export function formatClockTime(iso, timezone) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: timezone || undefined,
  }).format(ms).replace(/ /g, ' ');
}

/** 1_800_000 → '30 min'; 5_400_000 → '1 hr 30 min'. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Study-day key '2026-09-14' → 'Mon Sep 14'. */
export function formatStudyDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) return null;
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return `${WEEKDAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * The HA companion-app `data:` block. `tag` makes a repeat replace the earlier
 * card; `alertOnce` (HA: `alert_once`) lets that replacement arrive without
 * ringing again; `channel`/`importance` decide how loud it is on Android.
 */
export function pushData({ tag = null, group = null, channel = null, importance = null, alertOnce = false, ...extra } = {}) {
  const data = { ...extra };
  if (tag) data.tag = tag;
  if (group) data.group = group;
  if (channel) data.channel = channel;
  if (importance) data.importance = importance;
  if (alertOnce) data.alert_once = true;
  return data;
}

const DEFECTS = [
  ['none', /\bNone\b/],
  ['null', /\bnull\b/],
  ['undefined', /\bundefined\b/],
  ['plex-key', /\bplex:\d+/],
  ['slug', /\b[a-z0-9]+(?:-[a-z0-9]+){2,}\b/],
  ['iso-timestamp', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
  ['double-punctuation', /[?!.]\./],
  ['snake-case', /\b[A-Za-z]+_[a-z_]+\b/],
];

/** Every way the 2026-09 audit found a push rendered badly. Tests assert `[]`. */
export function findPushTextDefects(value) {
  const s = typeof value === 'string' ? value : '';
  if (!s.trim()) return ['empty'];
  return DEFECTS.filter(([, pattern]) => pattern.test(s)).map(([name]) => name);
}
