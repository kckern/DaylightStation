import { studyDayForInstant } from '#domains/school/studyDay.mjs';

const ELIGIBLE_GAMES = new Set(['chess', 'checkers', 'connect-four']);
const RESULTS = new Set(['win', 'loss', 'draw']);

export const BOARD_GAME_DAY_SCHEMA = 'piano.board-game-day/v1';

export function emptyBoardGameDay(studyDate) {
  return { schema: BOARD_GAME_DAY_SCHEMA, studyDate, learners: {} };
}

export class PianoBoardGameDayService {
  #store; #timezone; #boundaryHour; #now; #logger;

  constructor({ store, timezone = null, boundaryHour = 4, now = () => Date.now(), logger = null } = {}) {
    if (!store) throw new Error('PianoBoardGameDayService requires store');
    this.#store = store;
    this.#timezone = timezone;
    this.#boundaryHour = boundaryHour;
    this.#now = now;
    this.#logger = logger;
  }

  #studyDate() {
    return studyDayForInstant(this.#now(), { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
  }

  current(learnerId) {
    const studyDate = this.#studyDate();
    const day = this.#store.loadDay(studyDate);
    const learner = day.learners?.[learnerId] || {};
    return { studyDate, completedGames: Number(learner.completedGames) || 0 };
  }

  record({ learnerId, gameId, gameSessionId, completed, result }) {
    if (!learnerId || !ELIGIBLE_GAMES.has(gameId) || completed !== true || !RESULTS.has(result)) {
      return { ...this.current(learnerId), counted: false, duplicate: false };
    }
    if (!gameSessionId) throw new Error('completed board game requires gameSessionId');

    const studyDate = this.#studyDate();
    const day = this.#store.loadDay(studyDate);
    const prior = day.learners?.[learnerId] || { completedGames: 0, gameSessionIds: [] };
    const gameSessionIds = Array.isArray(prior.gameSessionIds) ? prior.gameSessionIds : [];
    if (gameSessionIds.includes(gameSessionId)) {
      return { studyDate, completedGames: Number(prior.completedGames) || 0, counted: false, duplicate: true };
    }

    const completedGames = (Number(prior.completedGames) || 0) + 1;
    day.learners = {
      ...(day.learners || {}),
      [learnerId]: { completedGames, gameSessionIds: [...gameSessionIds, gameSessionId] },
    };
    this.#store.saveDay(day);
    this.#logger?.info?.('piano.board-game-day.recorded', { learnerId, gameId, studyDate, completedGames });
    return { studyDate, completedGames, counted: true, duplicate: false };
  }
}

export default PianoBoardGameDayService;
