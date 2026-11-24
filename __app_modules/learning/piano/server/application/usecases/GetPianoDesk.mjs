/**
 * GetPianoDesk — what each player is working on, for the kiosk home screen: the
 * most recently practiced piece with real progress (at least one step earned),
 * its passages, and the next Silver step.
 *
 * The answer always comes from the same coaching policy Learn uses, so the home
 * screen and the score cannot disagree. It reads practice records, and the piece
 * log for the piece's Polish gem and diamond, with no Plex or network
 * dependency, so the home screen can paint quickly.
 *
 * When an admin has approved Learn segments for the score (cut against the same
 * XML the child practised), they replace the passages saved on the record, so
 * the strip follows a new segmentation at once instead of at the child's next
 * take. The projection lives in ../coachRecordProjection.mjs, shared with the
 * Polish reward.
 */
import { passageProgress } from '#shared/music/learnCoach.mjs';
import { projectRecord, recordFingerprint, recordSegments } from '../coachRecordProjection.mjs';
import { practiceKeyOfScore } from '../../../portable/music/practiceKey.mjs';

export { practiceKeyOfScore };

function latestActivity(record) {
  return [record?.learnCoach?.evidence?.at?.(-1)?.at, record?.learnCoach?.summary?.updatedAt, record?.updatedAt]
    .filter(Boolean).map(String).sort().at(-1) ?? '';
}

export class GetPianoDesk {
  #datastore; #configProjection; #pieceLog; #learnSegments; #clock; #timezone; #logger;

  /**
   * @param {object} deps
   * @param {(scoreId: string, contentSha256: string) => Array<{id, start, end, parts?}>|null} [deps.learnSegments]
   *   the score's admin-approved Learn segments for that content, or null
   */
  constructor({ datastore, configProjection, pieceLog = null, learnSegments = null, clock = () => new Date(), timezone = null, logger = console }) {
    this.#datastore = datastore;
    this.#learnSegments = learnSegments;
    this.#pieceLog = pieceLog;
    this.#configProjection = configProjection;
    this.#clock = clock;
    this.#timezone = timezone;
    this.#logger = logger;
  }

  #dayKey() {
    const now = this.#clock();
    if (!this.#timezone) return now.toISOString().slice(0, 10);
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.#timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }

  #piece({ scoreKey, record }, scoreIds, dayKey) {
    const scoreId = record?.learnCoach?.scoreId ?? scoreIds().get(scoreKey);
    const fingerprint = recordFingerprint(record);
    if (!scoreId || !fingerprint) return null;
    const segments = recordSegments(record, this.#learnSegments?.(scoreId, fingerprint));
    if (!segments.length) return null;
    const learn = this.#configProjection.raw?.()?.sheetmusic?.learn;
    const certification = learn?.certification;
    // The Gold ladder's speeds, household then piece (`pieces.<scoreId>`), as the kiosk resolves them.
    const piece = learn?.pieces?.[scoreId];
    const goldLadder = { tempos: piece?.goldTempos ?? learn?.goldTempos, minBpm: piece?.minBpm ?? learn?.minBpm };
    const projection = projectRecord({ record, scoreId, segments, certification, goldLadder, dayKey });
    const passages = projection.segments.filter((segment) => segment.kind !== 'join').map(passageProgress);
    // A piece someone only opened or tried is not one they are learning.
    if (!passages.some((passage) => passage.steps.done > 0 || passage.state === 'silver' || passage.state === 'gold')) return null;
    const next = projection.recommended;
    return {
      scoreId, scoreKey, practicedAt: latestActivity(record) || null,
      cover: this.#datastore.sheetMusicCover?.(scoreId) ?? null,
      total: projection.piece.total, silver: projection.piece.silver, gold: projection.piece.gold,
      pieceSilver: projection.piece.pieceSilver, polishReady: projection.piece.polishReady, joins: projection.piece.joins,
      next: next ? { passageId: next.passageId, skill: next.skill, label: next.label, start: next.range.start, end: next.range.end } : null,
      nextGoldPassageId: projection.piece.nextGoldPassageId,
      passages,
    };
  }

  /** The piece's Polish gem and diamond, from the piece log. Unreadable means none. */
  #polish(userId, scoreId) {
    if (!this.#pieceLog) return { gem: false, diamond: false };
    try {
      const mine = (this.#pieceLog.list(userId) ?? []).filter((entry) => entry?.scoreId === scoreId);
      return { gem: mine.some((e) => e.level === 'polish-gem'), diamond: mine.some((e) => e.level === 'polish-diamond') };
    } catch (error) {
      this.#logger.warn?.('piano.desk.polish_unreadable', { userId, scoreId, error: error.message });
      return { gem: false, diamond: false };
    }
  }

  /**
   * A player's pieces with real progress, newest first, stopping after `limit`
   * (Infinity for all). The home strip wants one; the office piece picker wants
   * every one, each projected exactly as the strip projects its one.
   */
  #pieces(userId, scoreIds, dayKey, limit) {
    const records = [...(this.#datastore.listPractice(userId) ?? [])]
      .sort((a, b) => latestActivity(b.record).localeCompare(latestActivity(a.record)));
    const pieces = [];
    const seen = new Set();
    for (const entry of records) {
      let piece = null;
      try { piece = this.#piece(entry, scoreIds, dayKey); } catch (error) {
        this.#logger.warn?.('piano.desk.record_skipped', { userId, scoreKey: entry.scoreKey, error: error.message });
      }
      // Two records can name one score (an older key beside a coached one): the newer wins.
      if (!piece || seen.has(piece.scoreId)) continue;
      seen.add(piece.scoreId);
      pieces.push({ ...piece, polish: this.#polish(userId, piece.scoreId) });
      if (pieces.length >= limit) break;
    }
    return pieces;
  }

  #name(userId) {
    const profile = this.#configProjection.profile(userId);
    return profile?.display_name || profile?.username || userId;
  }

  #player(userId, scoreIds, dayKey) {
    const [piece = null] = this.#pieces(userId, scoreIds, dayKey, 1);
    return { userId, name: this.#name(userId), piece };
  }

  /** Only older records need the library walk: coached ones name their score. Walked at most once per call. */
  #scoreIds() {
    let library = null;
    return () => {
      library ??= new Map((this.#datastore.listSheetMusicIds() ?? []).map((id) => [practiceKeyOfScore(id), id]));
      return library;
    };
  }

  /**
   * Every piece one player is learning, newest first: the office screen's piece
   * picker. The same projection as `execute()`, so a picker face and a home
   * card never disagree. Null for someone not on the roster.
   */
  forPlayer(userId) {
    if (!this.#configProjection.roster().includes(userId)) return null;
    return { userId, name: this.#name(userId), pieces: this.#pieces(userId, this.#scoreIds(), this.#dayKey(), Infinity) };
  }

  execute() {
    const scoreIds = this.#scoreIds();
    const dayKey = this.#dayKey();
    const players = this.#configProjection.roster().map((userId) => {
      try { return this.#player(userId, scoreIds, dayKey); } catch (error) {
        this.#logger.warn?.('piano.desk.player_skipped', { userId, error: error.message });
        const profile = this.#configProjection.profile(userId);
        return { userId, name: profile?.display_name || profile?.username || userId, piece: null };
      }
    });
    players.sort((a, b) => String(b.piece?.practicedAt ?? '').localeCompare(String(a.piece?.practicedAt ?? '')));
    return { players };
  }
}

export default GetPianoDesk;
