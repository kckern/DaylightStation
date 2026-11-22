/**
 * The per-child school showcase: one slide per child after the week's last
 * photo, with a collage of up to six pictures and two to five plain bullets.
 *
 * This policy builds the slide from the window's WorkItems and writes the
 * plain bullets, which show instantly and stand in whenever the AI-drafted
 * bullets are missing or refused. Kids watch the review: bullets carry counts
 * of things done (sessions, pages, words), never scores, and no praise.
 *
 * Pure: no I/O, no clock, no crypto.
 */
import { dedupeWorkItems, isWellFormed, workItemPriority } from './schoolWorkPolicy.mjs';

export const MAX_SHOWCASE_IMAGES = 6;
export const MAX_PLAIN_BULLETS = 5;

/** What a page is called on the slide; the platform's name is not on a WorkItem. */
const ACTIVITY_NOUN = 'printed page';

function weightOf(item) {
  const weight = Number(item.weight);
  return Number.isFinite(weight) ? weight : 0;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compareForShowcase(a, b) {
  return workItemPriority(a) - workItemPriority(b)
    || weightOf(b) - weightOf(a)
    || String(a.groupKey).localeCompare(String(b.groupKey));
}

/** Deterministic fingerprint of a child's week: sorted `groupKey:weight` pairs. */
export function showcaseItemsHash(items) {
  return (items || [])
    .map(item => `${item.groupKey}:${weightOf(item)}`)
    .sort()
    .join('|');
}

/** "Unit 3 · 4 sessions this week" → { label: 'Unit 3', count: 4 }. */
function splitGroupSuffix(subtitle, unit) {
  const raw = text(subtitle);
  const re = new RegExp(`(?:^|\\s·\\s)(\\d+) ${unit} this week$`);
  const match = raw.match(re);
  if (!match) return { label: raw || null, count: null };
  return { label: raw.slice(0, match.index).trim() || null, count: Number(match[1]) };
}

// --- Activity phrasing ------------------------------------------------------

/** "Maze · level 2" → "maze". The kind is the subtitle's first part, lowercased. */
function activityKind(item) {
  const first = text(item.subtitle).split(' · ')[0].trim().toLowerCase();
  return first || null;
}

/** Words that read the same for one or many ("sudoku", "coloring", "tracing"). */
function isInvariant(kind) {
  return /ing$/.test(kind) || /(^|\s)sudoku$/.test(kind);
}

function plural(kind) {
  if (isInvariant(kind)) return kind;
  if (/(s|x|z|ch|sh)$/.test(kind)) return `${kind}es`;
  return `${kind}s`;
}

function withArticle(kind) {
  if (/ing$/.test(kind)) return kind;
  return /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;
}

function joinNaturally(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * All of a child's activities as one bullet:
 * "1 printed page: a maze", "3 printed pages: mazes and sudoku".
 */
export function activityBullet(activities) {
  const n = activities.length;
  if (n === 0) return null;
  const counts = new Map();
  for (const item of activities) {
    const kind = activityKind(item);
    if (kind) counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  const head = `${n} ${n === 1 ? ACTIVITY_NOUN : `${ACTIVITY_NOUN}s`}`;
  if (counts.size === 0) return head;
  const kinds = [...counts.entries()].map(([kind, count]) => (count > 1 ? plural(kind) : withArticle(kind)));
  return `${head}: ${joinNaturally(kinds)}`;
}

// --- Bullets per kind ---------------------------------------------------------

function bookBullet(item) {
  const title = text(item.title) || 'a book';
  return item.verb === 'finished' ? `Finished ${title}` : `Started ${title}`;
}

function courseBullet(item) {
  const title = text(item.title) || 'Schoolwork';
  const { label, count } = splitGroupSuffix(item.subtitle, 'sessions');
  if (count) return `${title} · ${count} sessions`;
  return label ? `${title}: ${label}` : title;
}

function programBullet(item) {
  const title = text(item.title) || 'Language practice';
  // The group weight is the week's word total; one day's subtitle undercounts.
  const words = weightOf(item);
  if (words > 0) return `${title} · ${words} ${words === 1 ? 'word' : 'words'}`;
  return title;
}

/** The book a started/finished groupKey belongs to ("book:<id>:started" → "book:<id>"). */
function bookBase(item) {
  return String(item.groupKey).replace(/:(started|finished)$/, '');
}

/**
 * Up to five plain bullets for one child's deduped week, best first.
 * Activities share one bullet, placed where the first activity ranks.
 * A book both started and finished this week only says "Finished".
 *
 * @param {object[]} items deduped WorkItems for one child
 * @returns {string[]}
 */
export function plainBullets(items) {
  const sorted = [...(items || [])].filter(Boolean).sort(compareForShowcase);
  const finishedBooks = new Set(sorted.filter(i => i.kind === 'book' && i.verb === 'finished').map(bookBase));
  const activities = sorted.filter(i => i.kind === 'activity');

  const bullets = [];
  let activitiesPlaced = false;
  for (const item of sorted) {
    let bullet = null;
    if (item.kind === 'book') {
      if (item.verb !== 'finished' && finishedBooks.has(bookBase(item))) continue;
      bullet = bookBullet(item);
    } else if (item.kind === 'course') {
      bullet = courseBullet(item);
    } else if (item.kind === 'activity') {
      if (activitiesPlaced) continue;
      activitiesPlaced = true;
      bullet = activityBullet(activities);
    } else if (item.kind === 'program') {
      bullet = programBullet(item);
    } else {
      bullet = text(item.title) || null;
    }
    if (bullet && !bullets.includes(bullet)) bullets.push(bullet);
    if (bullets.length >= MAX_PLAIN_BULLETS) break;
  }
  return bullets;
}

function compact(item) {
  return {
    kind: item.kind,
    verb: item.verb,
    title: item.title ?? null,
    subtitle: item.subtitle ?? null,
    weight: weightOf(item),
  };
}

/**
 * One showcase per child with work in the window, ordered by name.
 *
 * @param {object[]} items WorkItems for the window
 * @param {string[]} dates the window's YYYY-MM-DD days
 * @returns {{ learnerId: string, learnerName: string, items: object[], images: string[],
 *   bullets: string[], source: 'plain', itemsHash: string }[]}
 */
export function buildShowcases(items, dates) {
  const inWindow = new Set(dates || []);
  const kept = (items || []).filter(isWellFormed).filter(item => inWindow.has(item.studyDay));

  const byLearner = new Map();
  for (const item of kept) {
    if (!byLearner.has(item.learnerId)) byLearner.set(item.learnerId, []);
    byLearner.get(item.learnerId).push(item);
  }

  const showcases = [];
  for (const [learnerId, learnerItems] of byLearner) {
    const deduped = dedupeWorkItems(learnerItems).sort(compareForShowcase);
    if (deduped.length === 0) continue;
    const images = [];
    for (const item of deduped) {
      if (typeof item.imageUrl === 'string' && item.imageUrl && !images.includes(item.imageUrl)) images.push(item.imageUrl);
      if (images.length >= MAX_SHOWCASE_IMAGES) break;
    }
    showcases.push({
      learnerId,
      learnerName: text(learnerItems.find(i => text(i.learnerName))?.learnerName) || learnerId,
      items: deduped.map(compact),
      images,
      bullets: plainBullets(deduped),
      source: 'plain',
      itemsHash: showcaseItemsHash(deduped),
    });
  }
  return showcases.sort((a, b) => a.learnerName.localeCompare(b.learnerName) || a.learnerId.localeCompare(b.learnerId));
}
