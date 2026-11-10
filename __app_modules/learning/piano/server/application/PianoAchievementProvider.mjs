/**
 * The piano's achievement evidence for the household gem economy — one
 * provider of the economy's IAchievementEvidence port (composed by
 * CompositeAchievementEvidence; see
 * __app_modules/money/economy/server/application/ports/IEarningEvidenceSource.mjs).
 *
 *   board-game-level (milestone)     the FIRST EVER win against each opponent
 *                                    level, per game. key `${game}:${level}`.
 *   piano-practice   (activity-days) study days with a PASSED challenge attempt.
 *   piano-rung       (milestone)     the first time a rung was reached, on
 *                                    either ladder, from the dated rung log.
 *                                    key `${ladder}:${game}:${rung}`.
 *
 * Milestones are reported only when their day falls inside the week, and a
 * key is the achievement's identity forever: the same win or rung never
 * reports twice, because only the first-ever occurrence is dated. Each
 * sub-source fails on its own — a broken attempt folder makes piano-practice
 * unavailable, never the board games.
 *
 * Levels and rungs are in the units the game stores and shows: chess's
 * opponent levels are zero-based (Level 0 … Level 9), the others one-based.
 * The rung log has no history before it shipped (2026-11), so a rung reached
 * before then is never a milestone.
 */
export const PIANO_ACHIEVEMENT_ACTIVITIES = Object.freeze(['board-game-level', 'piano-practice', 'piano-rung']);

export const BOARD_GAME_LABELS = Object.freeze({
  chess: 'Chess',
  checkers: 'Checkers',
  'connect-four': 'Connect Four',
});

const LADDER_LABELS = Object.freeze({ match: 'rung', addressing: 'reading rung' });

const inWeek = (day, week) => typeof day === 'string' && day >= week.from && day <= week.to;

/** The earlier of two dated occurrences: by study day, then by instant. */
const earlier = (a, b) => (!b || a.day < b.day || (a.day === b.day && (a.atMs ?? Infinity) < (b.atMs ?? Infinity)));

function attemptPurpose(attempt) {
  return attempt?.purpose ?? (attempt?.challenge_id ? 'challenge' : 'practice');
}

/**
 * @param {object} deps
 * @param {{listGameSummaries(gameId, userIds): Promise<Array>|Array}} deps.gameHistory  DataServicePianoGameRepository
 * @param {{listCreatedBetween(userId, {fromMs, toMs}): Array}} deps.attemptStore  YamlPianoAttemptStore
 * @param {{list(userId): Array<{at, game, ladder, from, to}>}} deps.rungLog  PianoRungLog
 * @param {object} [deps.logger]
 * @param {string[]} [deps.games]  board games to read
 */
export function createPianoAchievementProvider({
  gameHistory, attemptStore, rungLog, logger = null, games = Object.keys(BOARD_GAME_LABELS),
} = {}) {
  async function boardGameLevels({ learnerIds, week, studyDay }) {
    const out = Object.fromEntries(learnerIds.map((id) => [id, []]));
    const wanted = new Set(learnerIds);
    for (const game of games) {
      const first = new Map(); // `${userId}\u0000${level}` -> {day, atMs}
      for (const g of await gameHistory.listGameSummaries(game, learnerIds)) {
        if (!wanted.has(g.userId) || g.result !== 'win' || !g.completed || g.endedBy === 'left') continue;
        if (!Number.isFinite(g.level)) continue;
        const day = Number.isFinite(g.atMs) ? studyDay(g.atMs) : g.playedOn;
        if (!day) continue;
        const key = `${g.userId}\u0000${g.level}`;
        const candidate = { day, atMs: g.atMs, userId: g.userId, level: g.level };
        if (earlier(candidate, first.get(key))) first.set(key, candidate);
      }
      for (const win of first.values()) {
        if (!inWeek(win.day, week)) continue;
        out[win.userId].push({ key: `${game}:${win.level}`, day: win.day, label: `${BOARD_GAME_LABELS[game] ?? game} level ${win.level}` });
      }
    }
    for (const list of Object.values(out)) list.sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
    return out;
  }

  function practiceDays({ learnerIds, week, schoolMs, studyDay }) {
    const out = {};
    for (const id of learnerIds) {
      const days = new Set();
      for (const attempt of attemptStore.listCreatedBetween(id, schoolMs)) {
        if (attemptPurpose(attempt) !== 'challenge' || attempt?.verdict?.passed !== true) continue;
        const day = studyDay(Date.parse(attempt.created_at));
        if (inWeek(day, week)) days.add(day);
      }
      out[id] = [...days].sort();
    }
    return out;
  }

  function rungsReached({ learnerIds, week, studyDay }) {
    const out = {};
    for (const id of learnerIds) {
      const first = new Map(); // key -> {day, atMs, ...}
      for (const entry of rungLog.list(id)) {
        const atMs = Date.parse(entry?.at ?? '');
        const from = Number(entry?.from);
        const to = Number(entry?.to);
        if (!Number.isFinite(atMs) || !Number.isFinite(to) || !entry.game || !LADDER_LABELS[entry.ladder]) continue;
        const day = studyDay(atMs);
        // A jump of more than one rung reaches every rung in between.
        const lowest = Number.isFinite(from) && from < to ? from + 1 : to;
        for (let rung = lowest; rung <= to; rung += 1) {
          const key = `${entry.ladder}:${entry.game}:${rung}`;
          const candidate = { day, atMs, key, game: entry.game, ladder: entry.ladder, rung };
          if (earlier(candidate, first.get(key))) first.set(key, candidate);
        }
      }
      out[id] = [...first.values()]
        .filter((r) => inWeek(r.day, week))
        .sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key))
        .map((r) => ({ key: r.key, day: r.day, label: `${BOARD_GAME_LABELS[r.game] ?? r.game} ${LADDER_LABELS[r.ladder]} ${r.rung}` }));
    }
    return out;
  }

  const sources = [
    { activity: 'board-game-level', part: 'milestones', read: boardGameLevels },
    { activity: 'piano-practice', part: 'days', read: practiceDays },
    { activity: 'piano-rung', part: 'milestones', read: rungsReached },
  ];

  return {
    name: 'piano',
    activities: [...PIANO_ACHIEVEMENT_ACTIVITIES],
    async week(args = {}) {
      const learnerIds = (args.learnerIds ?? []).map(String);
      const learners = Object.fromEntries(learnerIds.map((id) => [id, { days: {}, milestones: {} }]));
      const unavailable = [];
      const t0 = Date.now();
      for (const source of sources) {
        try {
          const byLearner = await source.read({ ...args, learnerIds });
          for (const id of learnerIds) learners[id][source.part][source.activity] = byLearner[id] ?? [];
        } catch (error) {
          logger?.warn?.('piano.achievements.source-unavailable', {
            activity: source.activity, week: args.week?.from ?? null, error: error?.message ?? String(error),
          });
          unavailable.push(source.activity);
        }
      }
      logger?.debug?.('piano.achievements.week', {
        week: args.week?.from ?? null, learners: learnerIds.length, unavailable, ms: Date.now() - t0,
      });
      return { learners, contests: {}, unavailable };
    },
  };
}

export default createPianoAchievementProvider;
