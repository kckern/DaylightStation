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
 *
 * Which piece is a child's card (`#card`): their assigned piece
 * (`sheetmusic.learners.<id>.piece`), else their newest piece in their own track
 * (`sheetmusic.learners.<id>.collection`), else their newest piece outside every
 * other learner's track. An assigned piece, or a track, with nothing practised
 * yet shows fresh (no passages, `fresh: true`). An entry is one learner's only;
 * see ../deskAssignment.mjs.
 */
import { passageProgress } from '#shared/music/learnCoach.mjs';
import { projectRecord, recordFingerprint, recordSegments } from '../coachRecordProjection.mjs';
import { practiceKeyOfScore } from '../../../portable/music/practiceKey.mjs';
import { inTrack, resolveDeskAssignments } from '../deskAssignment.mjs';

export { practiceKeyOfScore };

function latestActivity(record) {
  return [record?.learnCoach?.evidence?.at?.(-1)?.at, record?.learnCoach?.summary?.updatedAt, record?.updatedAt]
    .filter(Boolean).map(String).sort().at(-1) ?? '';
}

export class GetPianoDesk {
  #datastore; #configProjection; #pieceLog; #learnSegments; #clock; #timezone; #logger;
  #refusedWarned = new Set();

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

  #player(userId, scoreIds, dayKey, assignments) {
    const piece = this.#card(userId, this.#pieces(userId, scoreIds, dayKey, Infinity), assignments, scoreIds);
    return { userId, name: this.#name(userId), piece };
  }

  /**
   * Each roster learner's `sheetmusic.learners` entry. Entries keyed by anyone
   * off the roster (a typo, or a catch-all like `*` or `all`) are refused, so
   * no config can put one piece or track on every child's card.
   */
  #assignments() {
    const { byUser, refused } = resolveDeskAssignments(this.#configProjection.raw?.()?.sheetmusic?.learners, this.#configProjection.roster());
    for (const { key, reason } of refused) {
      const id = `${key}\u0000${reason}`;
      if (this.#refusedWarned.has(id)) continue;
      this.#refusedWarned.add(id);
      this.#logger.warn?.('piano.desk.learner-refused', { key, reason });
    }
    return byUser;
  }

  /** A card for an assigned piece (or a track's first score) not yet practised. */
  #fresh(userId, scoreId) {
    return {
      scoreId, scoreKey: practiceKeyOfScore(scoreId), practicedAt: null,
      cover: this.#datastore.sheetMusicCover?.(scoreId) ?? null,
      total: 0, silver: 0, gold: 0, pieceSilver: false, polishReady: false, joins: { total: 0, silver: 0, gold: 0 },
      next: null, nextGoldPassageId: null, passages: [], fresh: true,
      polish: this.#polish(userId, scoreId),
    };
  }

  /**
   * The child's card, from every piece they have progress on (newest first):
   * their assigned piece; else their newest piece in their own track, or the
   * track's first score; else their newest piece outside other learners' tracks.
   */
  #card(userId, pieces, assignments, scoreIds) {
    const mine = assignments.get(userId) ?? { piece: null, track: null };
    const library = () => [...scoreIds().values()];
    if (mine.piece) {
      const assigned = pieces.find((piece) => piece.scoreId === mine.piece);
      if (assigned) return assigned;
      if (library().includes(mine.piece)) return this.#fresh(userId, mine.piece);
      this.#logger.warn?.('piano.desk.assigned-piece-missing', { userId, scoreId: mine.piece });
    }
    if (mine.track) {
      const inMine = pieces.find((piece) => inTrack(piece.scoreId, mine.track));
      if (inMine) return inMine;
      const first = library().filter((id) => inTrack(id, mine.track)).sort()[0];
      if (first) return this.#fresh(userId, first);
    }
    const others = [...assignments].filter(([id, a]) => id !== userId && a.track && a.track !== mine.track).map(([, a]) => a.track);
    return pieces.find((piece) => !others.some((track) => inTrack(piece.scoreId, track))) ?? null;
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
   * card never disagree: the strip's card comes first, the rest newest first.
   * Null for someone not on the roster.
   */
  forPlayer(userId) {
    if (!this.#configProjection.roster().includes(userId)) return null;
    const scoreIds = this.#scoreIds();
    const pieces = this.#pieces(userId, scoreIds, this.#dayKey(), Infinity);
    // The strip's card leads, so the picker and the home card never disagree.
    const card = this.#card(userId, pieces, this.#assignments(), scoreIds);
    return { userId, name: this.#name(userId), pieces: card ? [card, ...pieces.filter((piece) => piece.scoreId !== card.scoreId)] : pieces };
  }

  execute() {
    const scoreIds = this.#scoreIds();
    const dayKey = this.#dayKey();
    const assignments = this.#assignments();
    const players = this.#configProjection.roster().map((userId) => {
      try { return this.#player(userId, scoreIds, dayKey, assignments); } catch (error) {
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
