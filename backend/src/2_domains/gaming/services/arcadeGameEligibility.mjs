/**
 * May this person play this title on this device, right now?
 *
 * Pure, and deliberately POLICY-FREE. It evaluates rules it is handed; it does
 * not contain any. Whether Tuesdays are allowed, whether schoolwork must be
 * finished, and whether a title needs two controllers are household decisions
 * that live in configuration and state-gate assertions, so they can change
 * without this function changing.
 *
 * Permissive by default, on purpose. An empty policy allows play: a household
 * that has configured nothing should not find the arcade silently bricked, and
 * every restriction should be something someone deliberately wrote down.
 *
 * Every refusal carries a REASON. "No" with no explanation is the thing that
 * makes a system feel arbitrary to a child, and the reason is what a parent
 * needs in order to disagree with it.
 */

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function minutesOfDay(date) { return date.getHours() * 60 + date.getMinutes(); }

function parseClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function withinAnyWindow(windows, at) {
  if (!Array.isArray(windows) || windows.length === 0) return true;  // unrestricted
  const day = DAYS[at.getDay()];
  const now = minutesOfDay(at);
  return windows.some((w) => {
    const days = Array.isArray(w?.days) ? w.days.map((d) => String(d).slice(0, 3).toLowerCase()) : null;
    if (days && !days.includes(day)) return false;
    const from = parseClock(w?.from);
    const to = parseClock(w?.to);
    if (from === null || to === null) return true;   // a malformed window does not lock anyone out
    return from <= to ? (now >= from && now < to) : (now >= from || now < to);
  });
}

/**
 * @param {Object} input
 * @param {Date} input.at
 * @param {Object} [input.policy]        { windows, requires, titles }
 * @param {string} [input.contentId]
 * @param {Set<string>|string[]} [input.satisfied]  Assertions currently true of this person.
 * @param {boolean} [input.deviceBlocked]  The meter has lost sight of this device.
 * @param {number|null} [input.controllers]
 * @returns {{allowed: boolean, reasons: string[]}}
 */
export function assessEligibility({
  at, policy = {}, contentId = null, satisfied = [], deviceBlocked = false, controllers = null,
}) {
  const reasons = [];
  const have = satisfied instanceof Set ? satisfied : new Set(satisfied || []);
  const title = (policy?.titles && contentId) ? policy.titles[contentId] : null;

  if (deviceBlocked) reasons.push('device_unobservable');

  // Windows: the title's own override replaces the household default entirely,
  // so a title can be allowed outside general play hours or restricted within.
  const windows = title?.windows ?? policy?.windows;
  if (!withinAnyWindow(windows, at)) reasons.push('outside_play_window');

  for (const requirement of [...(policy?.requires || []), ...(title?.requires || [])]) {
    if (!have.has(requirement)) reasons.push(`requires:${requirement}`);
  }

  // A minimum-players title needs the controllers to actually be there. Unknown
  // is not zero: if we could not count, we do not refuse on that basis.
  if (title?.min_players && controllers !== null && controllers < title.min_players) {
    reasons.push(`needs_${title.min_players}_controllers`);
  }

  return { allowed: reasons.length === 0, reasons };
}

export default assessEligibility;
