/**
 * School's achievement provider for the economy's gems — one entry in
 * `CompositeAchievementEvidence` (`#apps/economy` IAchievementEvidence).
 *
 *   card-goal       activity days: a card-ladder day file with `doneAt` (any package)
 *   story-read      activity days: a credited story-time read in the reading log
 *   book-finished   milestone: the FIRST finish of a book on the book log, key = book id (ISBN)
 *   perfect-sheet   milestone: a graded curriculum sheet at 100%, key = session id,
 *                   dated by the study day it was GRADED (a sheet marked after
 *                   its week closed still lands in a week that is open)
 *   cards-mastered  milestone: every 10th word signed off across packages, key = the count
 *
 * Reads School's own stores and use cases, never files. Each sub-source fails
 * alone: it is warned and its activity listed in `unavailable`, so a damaged
 * book log costs the book gem's line, not the flashcard one. A failure for ANY
 * learner makes that activity unavailable for the week — the port has no
 * per-learner "indeterminate", and a partial read is not "nothing happened".
 * A dependency that was never wired is unavailable the same way.
 */
import {
  daysOfWeek, distinctDaysInWeek, firstFinishes, inWeek, isPerfectSheet, masteryMilestones, dayKey,
} from "../domain/achievements.mjs";
import { shelfItemView } from "../domain/bookShelf.mjs";

export const SCHOOL_ACHIEVEMENT_ACTIVITIES = Object.freeze(['card-goal', 'story-read', 'book-finished', 'perfect-sheet', 'cards-mastered']);

/**
 * @param {object} deps
 * @param {{achievementRecord: (a: {userId, from, to}) => Promise<{packages: Array<{doneDays: string[], signOffs: object[]}>}>}} [deps.cardLadder] - live CardLadderSittingService
 * @param {{listForDay: (learnerId: string, studyDay: string) => Promise<object[]>}} [deps.readingLog] - YamlReadingLogStore
 * @param {{listForLearner: (learnerId: string) => Promise<object[]>}} [deps.bookLog] - YamlBookLogStore
 * @param {{findByIsbn: (isbn: string) => Promise<{title?: string}|null>}} [deps.books] - book facts for the label
 * @param {{execute: (a: {learnerId: string}) => Promise<object[]>}} [deps.sessions] - ListLearnerSessions
 * @param {{getUnitSummary: (unitId: string) => Promise<{title?: string}|null>}} [deps.curriculum] - unit titles for the label
 * @param {object} [deps.logger]
 */
export function createSchoolAchievementProvider({
  cardLadder = null, readingLog = null, bookLog = null, books = null, sessions = null, curriculum = null, logger = console,
} = {}) {
  const sources = {
    cardLadder: typeof cardLadder?.achievementRecord === 'function',
    readingLog: typeof readingLog?.listForDay === 'function',
    bookLog: typeof bookLog?.listForLearner === 'function',
    sessions: typeof sessions?.execute === 'function',
  };

  async function cardLadderFacts(learnerId, week) {
    const { packages = [] } = await cardLadder.achievementRecord({ userId: learnerId, from: week.from, to: week.to });
    return {
      days: distinctDaysInWeek(packages.flatMap((p) => p.doneDays ?? []), week),
      milestones: masteryMilestones(packages.flatMap((p) => p.signOffs ?? [])).filter((m) => inWeek(m.day, week)),
    };
  }

  async function storyDays(learnerId, week) {
    const days = daysOfWeek(week);
    const counts = await Promise.all(days.map(async (day) => (await readingLog.listForDay(learnerId, day))?.length ?? 0));
    return days.filter((_, i) => counts[i] > 0);
  }

  async function finishedBooks(learnerId, week) {
    const readings = (await bookLog.listForLearner(learnerId)).map((r) => ({ ...r, bookId: shelfItemView(r).bookId }));
    const rows = [...firstFinishes(readings)].filter(([, { day }]) => inWeek(day, week));
    return Promise.all(rows.map(async ([bookId, { day }]) => {
      let title = null;
      try { title = (await books?.findByIsbn?.(bookId))?.title ?? null; } catch (error) {
        logger.warn?.('school.achievements.book-facts-failed', { learnerId, bookId, error: error?.message ?? String(error) });
      }
      return { key: bookId, day, label: title ?? 'A book' };
    }));
  }

  async function perfectSheets(learnerId, week, studyDay, unitTitles) {
    const rows = (await sessions.execute({ learnerId })) ?? [];
    const out = [];
    for (const s of rows.filter(isPerfectSheet)) {
      const ms = Date.parse(s.gradedAt);
      const day = typeof studyDay === 'function' && Number.isFinite(ms) ? studyDay(ms) : dayKey(s.studyDay ?? s.day);
      if (!inWeek(day, week)) continue;
      out.push({ key: s.sessionId, day, label: await unitTitles(s.unitId) });
    }
    return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.key < b.key ? -1 : 1));
  }

  return {
    name: 'school',
    activities: [...SCHOOL_ACHIEVEMENT_ACTIVITIES],

    async week({ learnerIds = [], week, studyDay = null } = {}) {
      const t0 = Date.now();
      const learners = Object.fromEntries(learnerIds.map((id) => [id, { days: {}, milestones: {} }]));
      const unavailable = new Set();
      if (!sources.cardLadder) { unavailable.add('card-goal'); unavailable.add('cards-mastered'); }
      if (!sources.readingLog) unavailable.add('story-read');
      if (!sources.bookLog) unavailable.add('book-finished');
      if (!sources.sessions) unavailable.add('perfect-sheet');

      // One title lookup per unit for the whole read.
      const titles = new Map();
      const unitTitles = (unitId) => {
        if (!titles.has(unitId)) {
          titles.set(unitId, Promise.resolve(curriculum?.getUnitSummary?.(unitId))
            .then((u) => u?.title ?? unitId)
            .catch((error) => {
              logger.warn?.('school.achievements.unit-title-failed', { unitId, error: error?.message ?? String(error) });
              return unitId;
            }));
        }
        return titles.get(unitId);
      };

      const guard = async (activities, learnerId, read) => {
        if (activities.some((a) => unavailable.has(a))) return;
        try { await read(); } catch (error) {
          logger.warn?.('school.achievements.source-failed', { learnerId, activities, error: error?.message ?? String(error) });
          activities.forEach((a) => unavailable.add(a));
        }
      };

      await Promise.all(learnerIds.map(async (id) => {
        const mine = learners[id];
        await Promise.all([
          guard(['card-goal', 'cards-mastered'], id, async () => {
            const facts = await cardLadderFacts(id, week);
            mine.days['card-goal'] = facts.days;
            mine.milestones['cards-mastered'] = facts.milestones;
          }),
          guard(['story-read'], id, async () => { mine.days['story-read'] = await storyDays(id, week); }),
          guard(['book-finished'], id, async () => { mine.milestones['book-finished'] = await finishedBooks(id, week); }),
          guard(['perfect-sheet'], id, async () => { mine.milestones['perfect-sheet'] = await perfectSheets(id, week, studyDay, unitTitles); }),
        ]);
      }));

      // An unavailable activity carries no facts at all, for anyone.
      for (const mine of Object.values(learners)) {
        for (const a of unavailable) { delete mine.days[a]; delete mine.milestones[a]; }
      }
      logger.debug?.('school.achievements.week-read', {
        week: week?.from ?? null, learners: learnerIds.length, unavailable: [...unavailable], ms: Date.now() - t0,
      });
      return { learners, contests: {}, unavailable: [...unavailable] };
    },
  };
}

export default createSchoolAchievementProvider;
