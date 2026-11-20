// Pure per-user triage policy. No I/O. An invalid config disables only that user.
const MODES = new Set(['off', 'dryRun', 'live']);
const DEFAULTS = { mode: 'dryRun', inboxWindowDays: 14, inboxMax: 200, autoArchiveConfidence: 0.92, overdueDays: 60, schedule: '0 5 * * *', taskDomain: 'personal' };
const MIN_AUTO_ARCHIVE_CONFIDENCE = 0.8;

const disabled = () => ({ enrolled: false, ...DEFAULTS, mode: 'off' });
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
const posInt = (v) => Number.isInteger(v) && v > 0;

export function resolveTriagePolicy({ configuration, username } = {}) {
  const triage = configuration?.triage;
  if (!isObject(triage) || triage.enabled !== true || !username) return disabled();
  const users = triage.users;
  if (!isObject(users) || !Object.prototype.hasOwnProperty.call(users, username)) return disabled();
  const override = users[username];
  if (override !== null && override !== undefined && !isObject(override)) return disabled();
  const merged = { ...DEFAULTS, ...(isObject(triage.defaults) ? triage.defaults : {}), ...(override || {}) };
  const valid = MODES.has(merged.mode)
    && posInt(merged.inboxWindowDays) && posInt(merged.inboxMax) && posInt(merged.overdueDays)
    && typeof merged.autoArchiveConfidence === 'number'
    && merged.autoArchiveConfidence >= MIN_AUTO_ARCHIVE_CONFIDENCE && merged.autoArchiveConfidence <= 1
    && typeof merged.schedule === 'string' && merged.schedule.trim() !== ''
    && typeof merged.taskDomain === 'string' && merged.taskDomain.trim() !== '';
  if (!valid) return disabled();
  const { mode, inboxWindowDays, inboxMax, autoArchiveConfidence, overdueDays, schedule, taskDomain } = merged;
  return { enrolled: true, mode, inboxWindowDays, inboxMax, autoArchiveConfidence, overdueDays, schedule, taskDomain };
}
