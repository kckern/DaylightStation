import path from 'node:path';
import { loadYamlSafe, saveYamlToPathAtomic, ensureDir, fileExists } from '#system/utils/FileIO.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BOARD_GAME_DAY_SCHEMA = 'piano.board-game-day/v1';
const emptyBoardGameDay = (studyDate) => ({ schema: BOARD_GAME_DAY_SCHEMA, studyDate, learners: {} });

export class YamlPianoBoardGameDayStore {
  #root;

  constructor({ historyRoot } = {}) {
    if (!historyRoot) throw new Error('YamlPianoBoardGameDayStore requires historyRoot');
    this.#root = historyRoot;
  }

  #fileFor(studyDate) {
    if (!DAY.test(String(studyDate))) throw new Error(`invalid study date: ${studyDate}`);
    return path.join(this.#root, `${studyDate}.yml`);
  }

  loadDay(studyDate) {
    const file = this.#fileFor(studyDate);
    if (!fileExists(file)) return emptyBoardGameDay(studyDate);
    const value = loadYamlSafe(file.replace(/\.yml$/, ''));
    if (!value || value.schema !== BOARD_GAME_DAY_SCHEMA || typeof value.learners !== 'object') {
      throw new Error(`corrupt board-game day file: ${file}`);
    }
    return value;
  }

  saveDay(day) {
    if (day?.schema !== BOARD_GAME_DAY_SCHEMA || typeof day.learners !== 'object') {
      throw new Error('refusing to save malformed board-game day');
    }
    const file = this.#fileFor(day.studyDate);
    ensureDir(this.#root);
    saveYamlToPathAtomic(file, day);
  }
}

export default YamlPianoBoardGameDayStore;
