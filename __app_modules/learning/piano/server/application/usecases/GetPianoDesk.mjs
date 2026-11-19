/**
 * GetPianoDesk — what each player is working on, for the kiosk home screen: the
 * piece practiced most recently, its passages, and the next Silver step.
 *
 * The answer always comes from the same coaching policy Learn uses, so the home
 * screen and the score cannot disagree. It reads practice records only, with no
 * Plex or network dependency, so the home screen can paint quickly.
 */
import { createCoachPlan, projectCoach } from '#shared/music/learnCoach.mjs';

const DEFAULT_PARTS = ['rh', 'lh'];

export const practiceKeyOfScore = (id) => String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);

function passageRanges(record) {
  const saved = record?.learnCoach?.summary?.passages;
  const ids = Array.isArray(saved) && saved.length ? saved.map((passage) => passage.id) : Object.keys(record?.learn?.segments ?? {});
  return ids.flatMap((id) => {
    const match = /^m(\d+)-(\d+)$/.exec(id);
    return match ? [{ id, inMeasure: Number(match[1]), outMeasure: Number(match[2]), playableParts: DEFAULT_PARTS }] : [];
  }).sort((a, b) => a.inMeasure - b.inMeasure);
}

function latestActivity(record) {
  return [record?.learnCoach?.evidence?.at?.(-1)?.at, record?.learnCoach?.summary?.updatedAt, record?.updatedAt]
    .filter(Boolean).map(String).sort().at(-1) ?? '';
}

function passageState(segment) {
  const steps = segment.skills.filter((skill) => skill.track === 'silver');
  const done = steps.filter((skill) => skill.ready).length;
  const started = done > 0 || steps.some((skill) => skill.successes > 0);
  const state = segment.certification.gold ? 'gold' : segment.certification.silver ? 'silver' : started ? 'learning' : 'todo';
  return { id: segment.id, start: segment.inMeasure, end: segment.outMeasure, state, steps: { done, total: steps.length } };
}

export class GetPianoDesk {
  #datastore; #configProjection; #clock; #timezone; #logger;

  constructor({ datastore, configProjection, clock = () => new Date(), timezone = null, logger = console }) {
    this.#datastore = datastore;
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
    const scoreId = record?.learnCoach?.scoreId ?? scoreIds.get(scoreKey);
    const fingerprint = record?.fingerprint?.contentSha256 ?? record?.learnCoach?.fingerprint;
    const segments = passageRanges(record);
    if (!scoreId || !fingerprint || !segments.length) return null;
    const certification = this.#configProjection.raw?.()?.sheetmusic?.learn?.certification;
    const plan = createCoachPlan({ scoreId, fingerprint, segments, certification });
    const projection = projectCoach({ plan, state: record.learnCoach ?? null, legacy: record, dayKey });
    const next = projection.recommended;
    return {
      scoreId, scoreKey, practicedAt: latestActivity(record) || null,
      total: projection.piece.total, silver: projection.piece.silver, gold: projection.piece.gold,
      next: next ? { passageId: next.passageId, skill: next.skill, label: next.label, start: next.range.start, end: next.range.end } : null,
      nextGoldPassageId: projection.piece.nextGoldPassageId,
      passages: projection.segments.map(passageState),
    };
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
    return { userId, name: profile?.display_name || profile?.username || userId, piece };
  }

  execute() {
    const scoreIds = new Map((this.#datastore.listSheetMusicIds() ?? []).map((id) => [practiceKeyOfScore(id), id]));
    const dayKey = this.#dayKey();
    const players = this.#configProjection.roster().map((userId) => this.#player(userId, scoreIds, dayKey));
    players.sort((a, b) => String(b.piece?.practicedAt ?? '').localeCompare(String(a.piece?.practicedAt ?? '')));
    return { players };
  }
}

export default GetPianoDesk;
