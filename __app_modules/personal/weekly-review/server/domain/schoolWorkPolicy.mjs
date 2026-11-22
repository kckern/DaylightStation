/**
 * School work curation for the weekly review.
 *
 * School hands over a flat list of WorkItems for the review window, and this
 * pure policy places them on days. `schoolAll` keeps every item. `school` is
 * the curated reel: one item per learner and groupKey for the week, at most
 * one item per child per day. A group goes on its heaviest day; when a better
 * item already holds that child's slot there, it falls back to the group's
 * next-best day with a free slot, and is left out of `school` when none is free.
 *
 * Kids watch the review, so items never carry scores and nothing here adds any.
 *
 * @typedef {{
 *   learnerId: string, learnerName: string,
 *   kind: 'book'|'course'|'activity'|'program',
 *   verb: 'finished'|'started'|'worked'|'completed',
 *   title: string, subtitle: string|null,
 *   at: string,
 *   studyDay: string,
 *   imageUrl: string|null,
 *   groupKey: string,
 *   weight: number,
 *   subject: string|null,
 * }} WorkItem
 */

const PRIORITY = {
  'book:finished': 0,
  'course:completed': 1,
  'activity': 2,
  'book:started': 3,
  'course:worked': 4,
  'program': 5,
};
const UNRANKED_PRIORITY = 6;

const GROUP_SUFFIX = {
  course: n => `${n} sessions this week`,
  program: n => `${n} days this week`,
};

/** The fields curation sorts and groups on. One item without them must not empty the week. */
export function isWellFormed(item) {
  return !!item
    && typeof item.studyDay === 'string'
    && typeof item.at === 'string'
    && typeof item.learnerId === 'string'
    && typeof item.groupKey === 'string';
}

/**
 * Rank of a work item for showing first: finished book 0, completed course 1,
 * activity 2, started book 3, worked course 4, program 5, anything else 6.
 */
export function workItemPriority(item) {
  return PRIORITY[`${item.kind}:${item.verb}`] ?? PRIORITY[item.kind] ?? UNRANKED_PRIORITY;
}
const priorityOf = workItemPriority;

function byAt(a, b) {
  return a.at.localeCompare(b.at);
}

function weightOf(item) {
  const weight = Number(item.weight);
  return Number.isFinite(weight) ? weight : 0;
}

/**
 * Group items by learner and groupKey (siblings can share a groupKey, such as
 * a family course). Each group lists its days best first (summed weight desc,
 * tie: latest day) with a representative item per day (heaviest, tie: latest
 * `at`), already carrying the group-total weight and the count suffix.
 */
function buildGroups(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.learnerId}\u0000${item.groupKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  return [...groups.values()].map(members => {
    const total = members.reduce((sum, item) => sum + weightOf(item), 0);
    const suffix = members.length > 1 ? GROUP_SUFFIX[members[0].kind]?.(members.length) : null;

    const byDay = new Map();
    for (const item of members) {
      if (!byDay.has(item.studyDay)) byDay.set(item.studyDay, []);
      byDay.get(item.studyDay).push(item);
    }
    const candidates = [...byDay.entries()]
      .map(([day, dayItems]) => ({ day, dayWeight: dayItems.reduce((sum, item) => sum + weightOf(item), 0), dayItems }))
      .sort((a, b) => b.dayWeight - a.dayWeight || b.day.localeCompare(a.day))
      .map(({ dayItems }) => {
        const rep = [...dayItems].sort((a, b) => weightOf(b) - weightOf(a) || b.at.localeCompare(a.at))[0];
        const subtitle = suffix ? (rep.subtitle ? `${rep.subtitle} · ${suffix}` : suffix) : rep.subtitle;
        return { ...rep, weight: total, subtitle };
      });
    return candidates;
  });
}

/** Per-child ranking: priority, then weight desc, then latest `at`, then groupKey. */
function compareForSlot(a, b) {
  return priorityOf(a) - priorityOf(b)
    || weightOf(b) - weightOf(a)
    || b.at.localeCompare(a.at)
    || a.groupKey.localeCompare(b.groupKey);
}

/**
 * Collapse items sharing a learner and groupKey into one, taken from the
 * group's heaviest day, with the group-total weight. Course and program groups
 * of more than one item get a count suffix on the subtitle.
 *
 * @param {WorkItem[]} items
 * @returns {WorkItem[]} new objects, one per learner and groupKey
 */
export function dedupeWorkItems(items) {
  return buildGroups((items || []).filter(isWellFormed)).map(candidates => candidates[0]);
}

/**
 * @param {WorkItem[]} items
 * @param {string[]} dates the window's YYYY-MM-DD days
 * @returns {Record<string, { school: WorkItem[], schoolAll: WorkItem[] }>}
 */
export function curateSchoolWork(items, dates) {
  const days = dates || [];
  const inWindow = new Set(days);
  const kept = (items || []).filter(isWellFormed).filter(item => inWindow.has(item.studyDay));

  // Higher-ranked groups claim slots first; each takes its best day with a free slot.
  const groups = buildGroups(kept).sort((a, b) => compareForSlot(a[0], b[0]));
  const taken = new Set();
  const placed = [];
  for (const candidates of groups) {
    const choice = candidates.find(c => !taken.has(`${c.learnerId}\u0000${c.studyDay}`));
    if (!choice) continue;
    taken.add(`${choice.learnerId}\u0000${choice.studyDay}`);
    placed.push(choice);
  }

  const result = {};
  for (const date of days) {
    result[date] = {
      school: placed.filter(item => item.studyDay === date).sort(byAt),
      schoolAll: kept.filter(item => item.studyDay === date).map(item => ({ ...item })).sort(byAt),
    };
  }
  return result;
}
