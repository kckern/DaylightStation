/**
 * Polish rewards: Polish is the whole piece played in time, the final join. A completed run that is
 * all green earns a MARK at each tempo it reaches (50%, 75%) and the piece's DIAMOND at score tempo
 * (100%), once per piece each. The old 50%-tempo gem is retired: it is no longer awarded, and a gem or
 * a diamond a piece already holds stays held (a diamond earned under the old 90% / 95-point rule is
 * still a diamond).
 *
 * The client reports the facts of one completed Polish run with its practice record write
 * (`polishRun`, see the practice route); this service judges them and dates what was earned in the
 * piece log as `polish-mark-50` / `polish-mark-75` / `polish-diamond`. The economy's
 * `piano-polish-diamond` milestone reads the diamond entries (PianoAchievementProvider). A client never
 * says "I earned a diamond": it reports the tempo, metronome, hands, completion and whether every
 * measure was green, and the thresholds live here.
 *
 * Nothing is earned until Polish is open for this player: every passage and every join below the top
 * join is Gold (the coach projection's `piece.polishReady`, the same projection the home strip reads,
 * against the score's admin-approved Learn segments when it has them).
 *
 * Best effort, like the piece log: `evaluate()` never throws, because a reward
 * check must never cost the child the practice write it rides on.
 * See __docs/reference/piano/sheet-music-player.md (Polish rewards).
 */
import { practiceKeyOfScore as keyOfScore } from '../../portable/music/practiceKey.mjs';
import { projectRecord, recordFingerprint, recordSegments } from './coachRecordProjection.mjs';

/** The tempos at which an all-green run is marked; the last is score tempo, which earns the diamond. */
export const POLISH_MARK_TEMPO_PERCENTS = Object.freeze([50, 75]);
export const POLISH_DIAMOND_TEMPO_PERCENT = 100;

const isPart = (p) => (typeof p === 'number' && Number.isInteger(p)) || (typeof p === 'string' && p.length > 0 && p.length <= 64);

/** Same buckets as the browser's polishTiers.tierOf; for the log only. */
function tierOf(tempoMult) {
  if (Math.abs(tempoMult - 1) <= 1e-6) return 'full';
  if (tempoMult < 0.8) return 'slow';
  if (tempoMult < 1) return 'medium';
  return 'overclocked';
}

const none = (reason, { tempoPercent = null, score = null, tier = null } = {}) => ({ reason, gem: false, diamond: false, marks: [], tempoPercent, score, tier });

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
  if (run.allGreen !== true) return none('not-all-green', facts);
  const marks = POLISH_MARK_TEMPO_PERCENTS.filter((mark) => tempoPercent >= mark);
  if (!marks.length) return none('slow-tempo', facts);
  return { reason: 'qualified', gem: false, diamond: tempoPercent >= POLISH_DIAMOND_TEMPO_PERCENT, marks, ...facts };
}

/**
 * Whether Polish is open: every passage and every join below the top is Gold. With approved segments
 * the record is projected onto them; certification only shapes the Silver steps and dayKey only the
 * review and set-aside queues, so neither changes which units are Gold.
 */
function polishOpen(record, scoreId, authored = null) {
  if (record?.learnCoach?.scoreId !== scoreId) return false;
  const segments = recordSegments(record, authored);
  if (!segments.length) return false;
  return projectRecord({ record, scoreId, segments }).piece.polishReady === true;
}

export class PianoPolishReward {
  #pieceLog; #learnSegments; #logger;

  /**
   * @param {object} deps
   * @param {(scoreId: string, contentSha256: string) => Array<{id, start, end, parts?}>|null} [deps.learnSegments]
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
      gem: result.gem, diamond: result.diamond, newGem: result.newGem, newDiamond: result.newDiamond, marks: result.marks,
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

  #polishOpen(record, scoreId) {
    const fingerprint = recordFingerprint(record);
    const authored = fingerprint && this.#learnSegments ? this.#learnSegments(scoreId, fingerprint) : null;
    return polishOpen(record, scoreId, authored);
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
      if (!this.#polishOpen(record, scoreId)) return { ...none('polish-locked', judged), ...quiet };
      const fingerprint = record?.fingerprint?.contentSha256 ?? null;
      const detail = { tempoPercent: judged.tempoPercent, score: judged.score };
      const earn = (level) => !holds(level)
        && this.#pieceLog.note({ userId, scoreId, level, fingerprint, detail }) !== null;
      for (const mark of judged.marks) earn(`polish-mark-${mark}`);
      const newDiamond = judged.diamond ? earn('polish-diamond') : false;
      return {
        ...judged,
        // The gem is retired: a gem the piece already holds stays held, none is awarded now.
        gem: holds('polish-gem'),
        diamond: newDiamond || holds('polish-diamond'),
        newGem: false, newDiamond,
      };
    } catch (error) {
      this.#logger?.warn?.('piano.polish.reward-failed', { userId, scoreId, error: error?.message ?? String(error) });
      return { ...none('log-unavailable', judged), ...quiet };
    }
  }
}

export default PianoPolishReward;
