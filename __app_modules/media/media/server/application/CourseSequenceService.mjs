/**
 * CourseSequenceService — keeps a course watchlist moving.
 *
 * A course watchlist (data/content/lists/watchlists/courses.yml) lists courses
 * (containers, e.g. Plex seasons) in the order they should be taken; a program
 * slot pointing at it plays the next episode of the first unfinished course.
 * Run nightly, this service:
 *
 *  1. retires each course whose episodes are all watched or skipped
 *     (`watched: true`, `completed: <date>`), so the list moves on to the next;
 *  2. keeps one course queued behind the current one: when fewer than two
 *     unfinished courses remain it appends a random untouched course from the
 *     list's `metadata.pool`, marked `auto_picked: <date>` so it can be seen and
 *     swapped before it starts.
 *
 * The list is saved only when something changed.
 */
const QUEUED_AHEAD = 2;
const WATCHED_PERCENT = 90;

const isDone = (state) => Boolean(state && (state.skipped || state.watched || (state.percent || 0) >= WATCHED_PERCENT));
const isTouched = (state) => Boolean(state && (state.skipped || (state.percent || 0) > 0 || (state.playhead || 0) > 0));

export class CourseSequenceService {
  /**
   * @param {Object} deps
   * @param {() => Promise<Object|null>} deps.loadList - the raw watchlist document
   * @param {(doc: Object) => Promise<void>} deps.saveList
   * @param {(contentId: string) => Promise<Array<{id: string, title: string}>>} deps.listChildren
   * @param {() => Promise<Map<string, Object>>} deps.loadProgress - contentId -> progress
   * @param {() => number} [deps.random]
   * @param {() => string} deps.today - YYYY-MM-DD
   * @param {() => string} deps.newUid
   */
  constructor({ loadList, saveList, listChildren, loadProgress, random = Math.random, today, newUid, logger = console }) {
    this.loadList = loadList;
    this.saveList = saveList;
    this.listChildren = listChildren;
    this.loadProgress = loadProgress;
    this.random = random;
    this.today = today;
    this.newUid = newUid;
    this.logger = logger;
  }

  async run() {
    const result = { retired: [], picked: [], unfinished: 0 };
    const doc = await this.loadList();
    if (!doc || !Array.isArray(doc.items)) return result;

    const progress = await this.loadProgress();
    const date = this.today();

    for (const item of doc.items) {
      const contentId = item?.play?.contentId;
      if (!contentId || item.watched) continue;
      const episodes = await this.listChildren(contentId);
      if (episodes.length && episodes.every(ep => isDone(progress.get(ep.id)))) {
        item.watched = true;
        item.completed = date;
        result.retired.push(contentId);
        this.logger.info?.('media.courses.retired', { contentId, title: item.title ?? null });
      }
    }

    result.unfinished = doc.items.filter(item => item?.play?.contentId && !item.watched).length;

    const pool = doc.metadata?.pool;
    if (pool && result.unfinished < QUEUED_AHEAD) {
      const listed = new Set(doc.items.map(item => item?.play?.contentId).filter(Boolean));
      const untouched = [];
      for (const candidate of await this.listChildren(pool)) {
        if (listed.has(candidate.id)) continue;
        const episodes = await this.listChildren(candidate.id);
        if (episodes.length && !episodes.some(ep => isTouched(progress.get(ep.id)))) untouched.push(candidate);
      }
      if (untouched.length) {
        const pick = untouched[Math.floor(this.random() * untouched.length)];
        doc.items.push({ title: pick.title, play: { contentId: pick.id }, uid: this.newUid(), auto_picked: date });
        result.picked.push(pick.id);
        result.unfinished += 1;
        this.logger.info?.('media.courses.auto_picked', { contentId: pick.id, title: pick.title, candidates: untouched.length });
      } else {
        this.logger.warn?.('media.courses.pool_empty', { pool });
      }
    }

    if (result.retired.length || result.picked.length) await this.saveList(doc);
    this.logger.info?.('media.courses.checked', { ...result, retired: result.retired.length, picked: result.picked.length });
    return result;
  }
}
