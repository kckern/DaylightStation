/**
 * Polish rewards: a near-perfect whole-piece run earns the piece a gem (at 50%
 * tempo or faster) and a diamond (at 90% or faster), once per piece each.
 *
 * The client reports the facts of one completed Polish run with its practice
 * record write (`polishRun`, see the practice route); this service judges them
 * and dates what was earned in the piece log as `polish-gem` / `polish-diamond`.
 * The economy's `piano-polish-gem` and `piano-polish-diamond` milestones read
 * those entries (PianoAchievementProvider). A client never says "I earned a
 * gem": it reports the score, tempo, metronome, hands and completion, and the
 * thresholds live here.
 *
 * Nothing is earned until the piece is all Gold for this player: the piece
 * log's dated `gold` entry (the same entry the `piano-piece` milestone pays
 * from), or, for a piece finished before the log existed, the saved coach
 * summary showing every passage Gold. When the score has admin-approved Learn
 * segments for the XML the child practised, that summary is re-read against
 * them (the same projection the home strip uses), so a passage the admin cut
 * differently has to be earned again before the piece is all Gold.
 *
 * Best effort, like the piece log: `evaluate()` never throws, because a reward
 * check must never cost the child the practice write it rides on.
 * See __docs/reference/piano/sheet-music-player.md (Polish rewards).
 */
import { practiceKeyOfScore as keyOfScore } from '../../portable/music/practiceKey.mjs';
import { projectRecord, recordFingerprint, recordSegments } from './usecases/GetPianoDesk.mjs';

export const POLISH_REWARD_MIN_SCORE = 95;
export const POLISH_GEM_TEMPO_PERCENT = 50;
export const POLISH_DIAMOND_TEMPO_PERCENT = 90;

const isPart = (p) => (typeof p === 'number' && Number.isInteger(p)) || (typeof p === 'string' && p.length > 0 && p.length <= 64);

/** Same buckets as the browser's polishTiers.tierOf; for the log only. */
function tierOf(tempoMult) {
  if (Math.abs(tempoMult - 1) <= 1e-6) return 'full';
  if (tempoMult < 0.8) return 'slow';
  if (tempoMult < 1) return 'medium';
  return 'overclocked';
}

const none = (reason, { tempoPercent = null, score = null, tier = null } = {}) => ({ reason, gem: false, diamond: false, tempoPercent, score, tier });

/**
 * Judge one reported run on its own facts (not the piece's Gold state).
 * `base` is the plain run score (round(100 × mean measure combined)), never
 * the overclocked display score.
 * @returns {{reason: string, gem: boolean, diamond: boolean, tempoPercent: number|null, score: number|null, tier: string|null}}
 */
export function judgePolishRun(run) {
  if (!run || typeof run !== 'object') return none('invalid-run');
  const { tempoMult, base, parts, activeParts } = run;
  if (typeof tempoMult !== 'number' || !Number.isFinite(tempoMult) || tempoMult <= 0 || tempoMult > 4
    || typeof base !== 'number' || !Number.isFinite(base) || base < 0 || base > 100
    || !Array.isArray(parts) || !parts.length || parts.length > 16 || !parts.every(isPart)
    || !Array.isArray(activeParts) || activeParts.length > 16 || !activeParts.every(isPart)) return none('invalid-run');
  const tempoPercent = Math.round(tempoMult * 100);
  const score = Math.round(base);
  const facts = { tempoPercent, score, tier: tierOf(tempoMult) };
  if (run.completed !== true || run.mixed !== false) return none('incomplete', facts);
  if (run.metronome !== true) return none('metronome-off', facts);
  const active = new Set(activeParts.map(String));
  if (!parts.every((p) => active.has(String(p)))) return none('one-hand', facts);
  if (score < POLISH_REWARD_MIN_SCORE) return none('low-score', facts);
  if (tempoPercent < POLISH_GEM_TEMPO_PERCENT) return none('slow-tempo', facts);
  return { reason: 'qualified', gem: true, diamond: tempoPercent >= POLISH_DIAMOND_TEMPO_PERCENT, ...facts };
}

/**
 * Gold on every passage. With approved segments it projects the record onto
 * them; certification only shapes the Silver steps and dayKey only the review
 * and set-aside queues, so neither changes which passages are Gold.
 */
function coachAllGold(record, scoreId, authored = null, certification = undefined, dayKey = undefined) {
  const coach = record?.learnCoach;
  if (coach?.scoreId !== scoreId) return false;
  if (authored?.length) {
    const { piece } = projectRecord({ record, scoreId, segments: recordSegments(record, authored), certification, dayKey });
    return piece.total > 0 && piece.gold === piece.total;
  }
  const summary = coach?.summary;
  return Number.isInteger(summary?.total) && summary.total > 0 && summary.gold === summary.total;
}

export class PianoPolishReward {
  #pieceLog; #learnSegments; #logger;

  /**
   * @param {object} deps
   * @param {(scoreId: string, contentSha256: string) => Array<{id, start, end}>|null} [deps.learnSegments]
   *   the score's admin-approved Learn segments for that content, or null
   */
  constructor({ pieceLog, learnSegments = null, logger = null }) {
    if (!pieceLog) throw new Error('PianoPolishReward requires a piece log');
    this.#pieceLog = pieceLog;
    this.#learnSegments = learnSegments;
    this.#logger = logger;
  }

  /**
   * @param {object} args
   * @param {string} args.userId
   * @param {string} args.scoreKey  the practice record's key; the run's scoreId must map to it
   * @param {object} args.run       { scoreId, tempoMult, metronome, completed, mixed, parts, activeParts, base }
   * @param {object} [args.record]  the saved practice record (fingerprint, learnCoach summary)
   * @returns {{reason, gem, diamond, newGem, newDiamond, tempoPercent, score, tier}}
   *   gem/diamond: the piece holds it (earned now or before); newGem/newDiamond: this run earned it.
   */
  evaluate({ userId, scoreKey, run, record = {} }) {
    const scoreId = typeof run?.scoreId === 'string' ? run.scoreId : null;
    const result = this.#judge({ userId, scoreKey, scoreId, run, record });
    this.#logger?.info?.('piano.polish.reward', {
      userId, scoreId, tier: result.tier, tempoPercent: result.tempoPercent, score: result.score, reason: result.reason,
      gem: result.gem, diamond: result.diamond, newGem: result.newGem, newDiamond: result.newDiamond,
    });
    return result;
  }

  /**
   * The Polish gem and diamond a player's piece already holds, for screens
   * that show them (the passage board reads this through the practice GET).
   * Matched on the practice record's key, which is all that route knows.
   * Never throws: an unreadable log answers nothing held.
   * @returns {{gem: boolean, diamond: boolean}}
   */
  holdings({ userId, scoreKey }) {
    if (!userId || userId === 'guest' || !scoreKey) return { gem: false, diamond: false };
    try {
      const mine = this.#pieceLog.list(userId).filter((entry) => typeof entry?.scoreId === 'string' && keyOfScore(entry.scoreId) === scoreKey);
      return { gem: mine.some((e) => e.level === 'polish-gem'), diamond: mine.some((e) => e.level === 'polish-diamond') };
    } catch (error) {
      this.#logger?.warn?.('piano.polish.holdings-failed', { userId, scoreKey, error: error?.message ?? String(error) });
      return { gem: false, diamond: false };
    }
  }

  #allGold(record, scoreId) {
    const fingerprint = recordFingerprint(record);
    const authored = fingerprint && this.#learnSegments ? this.#learnSegments(scoreId, fingerprint) : null;
    return coachAllGold(record, scoreId, authored);
  }

  #judge({ userId, scoreKey, scoreId, run, record }) {
    const quiet = { newGem: false, newDiamond: false };
    if (!userId || userId === 'guest') return { ...none('guest'), ...quiet };
    if (!scoreId || keyOfScore(scoreId) !== scoreKey) return { ...none(scoreId ? 'wrong-score' : 'invalid-run'), ...quiet };
    const judged = judgePolishRun(run);
    if (judged.reason !== 'qualified') return { ...judged, ...quiet };
    try {
      const entries = this.#pieceLog.list(userId);
      const holds = (level) => entries.some((e) => e?.scoreId === scoreId && e?.level === level);
      if (!holds('gold') && !this.#allGold(record, scoreId)) return { ...none('not-all-gold', judged), ...quiet };
      const fingerprint = record?.fingerprint?.contentSha256 ?? null;
      const detail = { tempoPercent: judged.tempoPercent, score: judged.score };
      const earn = (level) => !holds(level)
        && this.#pieceLog.note({ userId, scoreId, level, fingerprint, detail }) !== null;
      const newGem = earn('polish-gem');
      const newDiamond = judged.diamond ? earn('polish-diamond') : false;
      return {
        ...judged,
        gem: newGem || holds('polish-gem'),
        diamond: newDiamond || holds('polish-diamond'),
        newGem, newDiamond,
      };
    } catch (error) {
      this.#logger?.warn?.('piano.polish.reward-failed', { userId, scoreId, error: error?.message ?? String(error) });
      return { ...none('log-unavailable', judged), ...quiet };
    }
  }
}

export default PianoPolishReward;
