/**
 * GetPianoDesk — what each player is working on, for the kiosk home screen: the
 * most recently practiced piece with real progress (at least one step earned),
 * its passages, and the next Silver step.
 *
 * The answer always comes from the same coaching policy Learn uses, so the home
 * screen and the score cannot disagree. It reads practice records, and the piece
 * log for the piece's Polish gem and diamond, with no Plex or network
 * dependency, so the home screen can paint quickly.
 */
import { createCoachPlan, passageProgress, projectCoach } from '#shared/music/learnCoach.mjs';
import { practiceKeyOfScore } from '../../../portable/music/practiceKey.mjs';

export { practiceKeyOfScore };

const DEFAULT_PARTS = ['rh', 'lh'];

function passageRanges(record) {
  const saved = record?.learnCoach?.summary?.passages;
  if (Array.isArray(saved) && saved.length) {
    return saved.filter((passage) => Number.isInteger(passage?.start) && Number.isInteger(passage?.end)).map((passage) => ({
      id: passage.id, inMeasure: passage.start, outMeasure: passage.end,
      playableParts: Array.isArray(passage.parts) && passage.parts.length ? passage.parts : DEFAULT_PARTS,
    }));
  }
  const planned = Object.keys(record?.learn?.segments ?? {}).flatMap((id) => {
    const match = /^m(\d+)-(\d+)$/.exec(id);
    return match ? [{ id, inMeasure: Number(match[1]), outMeasure: Number(match[2]) }] : [];
  });
  // Older records do not say which hands a passage has. Two hands is right for
  // nearly the whole library, and the next save stores the real parts.
  return planned.map((passage) => ({ ...passage, playableParts: DEFAULT_PARTS })).sort((x, y) => x.inMeasure - y.inMeasure);
}

function latestActivity(record) {
  return [record?.learnCoach?.evidence?.at?.(-1)?.at, record?.learnCoach?.summary?.updatedAt, record?.updatedAt]
    .filter(Boolean).map(String).sort().at(-1) ?? '';
}

export class GetPianoDesk {
  #datastore; #configProjection; #pieceLog; #clock; #timezone; #logger;

  constructor({ datastore, configProjection, pieceLog = null, clock = () => new Date(), timezone = null, logger = console }) {
    this.#datastore = datastore;
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
    const fingerprint = record?.fingerprint?.contentSha256 ?? record?.learnCoach?.fingerprint;
    const segments = passageRanges(record);
    if (!scoreId || !fingerprint || !segments.length) return null;
    const certification = this.#configProjection.raw?.()?.sheetmusic?.learn?.certification;
    const plan = createCoachPlan({ scoreId, fingerprint, segments, certification });
    const projection = projectCoach({ plan, state: record.learnCoach ?? null, legacy: record, dayKey });
    const passages = projection.segments.map(passageProgress);
    // A piece someone only opened or tried is not one they are learning.
    if (!passages.some((passage) => passage.steps.done > 0 || passage.state === 'silver' || passage.state === 'gold')) return null;
    const next = projection.recommended;
    return {
      scoreId, scoreKey, practicedAt: latestActivity(record) || null,
      cover: this.#datastore.sheetMusicCover?.(scoreId) ?? null,
      total: projection.piece.total, silver: projection.piece.silver, gold: projection.piece.gold,
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

  #player(userId, scoreIds, dayKey) {
    const profile = this.#configProjection.profile(userId);
    const records = [...(this.#datastore.listPractice(userId) ?? [])]
      .sort((a, b) => latestActivity(b.record).localeCompare(latestActivity(a.record)));
    let piece = null;
    for (const entry of records) {
      try { piece = this.#piece(entry, scoreIds, dayKey); } catch (error) {
        this.#logger.warn?.('piano.desk.record_skipped', { userId, scoreKey: entry.scoreKey, error: error.message });
      }
      if (piece) break;
    }
    if (piece) piece = { ...piece, polish: this.#polish(userId, piece.scoreId) };
    return { userId, name: profile?.display_name || profile?.username || userId, piece };
  }

  execute() {
    // Only older records need this: coached ones name their score.
    let library = null;
    const scoreIds = () => {
      library ??= new Map((this.#datastore.listSheetMusicIds() ?? []).map((id) => [practiceKeyOfScore(id), id]));
      return library;
    };
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
