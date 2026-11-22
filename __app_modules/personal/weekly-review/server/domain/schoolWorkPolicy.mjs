/**
 * School work curation for the weekly review.
 *
 * School hands over a flat list of WorkItems for the review window; this pure
 * policy places them on days. `schoolAll` keeps every item; `school` is the
 * curated reel: one item per groupKey for the week (on its heaviest day), and
 * at most one item per child per day.
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
const LOWEST_PRIORITY = 6;

const GROUP_SUFFIX = {
  course: n => `${n} sessions this week`,
  program: n => `${n} days this week`,
};

function priorityOf(item) {
  return PRIORITY[`${item.kind}:${item.verb}`] ?? PRIORITY[item.kind] ?? LOWEST_PRIORITY;
}

function byAt(a, b) {
  return a.at.localeCompare(b.at);
}

function weightOf(item) {
  return Number(item.weight) || 0;
}

/**
 * Collapse items sharing a groupKey into one. The kept item comes from the
 * day with the highest summed weight (tie: latest day), and within that day
 * the heaviest item (tie: latest `at`). Its weight becomes the group total;
 * course and program groups of more than one item get a count suffix.
 *
 * @param {WorkItem[]} items
 * @returns {WorkItem[]} new objects, one per groupKey
 */
export function dedupeWorkItems(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.groupKey)) groups.set(item.groupKey, []);
    groups.get(item.groupKey).push(item);
  }

  return [...groups.values()].map(group => {
    const dayTotals = new Map();
    for (const item of group) dayTotals.set(item.studyDay, (dayTotals.get(item.studyDay) || 0) + weightOf(item));
    const [bestDay] = [...dayTotals.entries()]
      .sort(([dayA, totalA], [dayB, totalB]) => totalB - totalA || dayB.localeCompare(dayA))[0];
    const kept = group
      .filter(item => item.studyDay === bestDay)
      .sort((a, b) => weightOf(b) - weightOf(a) || b.at.localeCompare(a.at))[0];

    const total = group.reduce((sum, item) => sum + weightOf(item), 0);
    const suffix = group.length > 1 ? GROUP_SUFFIX[kept.kind]?.(group.length) : null;
    const subtitle = suffix ? (kept.subtitle ? `${kept.subtitle} · ${suffix}` : suffix) : kept.subtitle;
    return { ...kept, weight: total, subtitle };
  });
}

function onePerLearner(items) {
  const best = new Map();
  for (const item of items) {
    const current = best.get(item.learnerId);
    const better = !current
      || priorityOf(item) < priorityOf(current)
      || (priorityOf(item) === priorityOf(current) && weightOf(item) > weightOf(current));
    if (better) best.set(item.learnerId, item);
  }
  return [...best.values()];
}

/**
 * @param {WorkItem[]} items
 * @param {string[]} dates the window's YYYY-MM-DD days
 * @returns {Record<string, { school: WorkItem[], schoolAll: WorkItem[] }>}
 */
export function curateSchoolWork(items, dates) {
  const inWindow = new Set(dates);
  const kept = (items || []).filter(item => inWindow.has(item.studyDay));
  const curated = dedupeWorkItems(kept);

  const result = {};
  for (const date of dates) {
    const dayAll = kept.filter(item => item.studyDay === date).map(item => ({ ...item })).sort(byAt);
    const dayCurated = onePerLearner(curated.filter(item => item.studyDay === date)).sort(byAt);
    result[date] = { school: dayCurated, schoolAll: dayAll };
  }
  return result;
}
