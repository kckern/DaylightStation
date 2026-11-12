import {
  RUBRIC_INSTRUCTIONS, RUBRIC_LEVELS, LEVEL_TARGETS_DEFAULT, DEFAULT_TARGET_NPM,
  parseCaptionCues, transcriptFor, measuredTarget, levelTarget, spearman, contentHash,
} from '../../portable/practice/lessonExpectation.mjs';

const GATEWAY_TIMEOUT_MS = 30000;
const norm = (s) => String(s ?? '').trim().toLowerCase();
const seedKey = (show, season, episode) => `${norm(show)}|${Number(season)}|${Number(episode)}`;

/**
 * BuildLessonExpectations — writes one expectation record per piano lesson:
 * measured (the audit's engaged sittings) → ai (one rubric `score` call over
 * the caption transcript) → default (watch-only, target 0). Idempotent: a
 * lesson whose caption hash and source are unchanged is skipped. Each record
 * is written as soon as it is computed; one failure never stops the run.
 */
export class BuildLessonExpectations {
  #source; #store; #gateway; #levelTargets; #logger; #clock;

  constructor({ lessonSource, store, decisionGateway = null, levelTargets = LEVEL_TARGETS_DEFAULT, logger = console, clock = () => new Date() }) {
    this.#source = lessonSource;
    this.#store = store;
    this.#gateway = decisionGateway;
    this.#levelTargets = Array.isArray(levelTargets) && levelTargets.length === 4 ? levelTargets : LEVEL_TARGETS_DEFAULT;
    this.#logger = logger;
    this.#clock = clock;
  }

  async #rubric(lesson, transcript) {
    const res = await this.#gateway.evaluate(
      { title: lesson.title, durationMin: lesson.durationSec ? Math.round(lesson.durationSec / 60) : null, transcript },
      { handsOn: { type: 'score', instructions: RUBRIC_INSTRUCTIONS, levels: [...RUBRIC_LEVELS] } },
      { timeout: GATEWAY_TIMEOUT_MS },
    );
    const a = res?.answers?.handsOn;
    const score = Number(a?.score);
    if (!Number.isFinite(score)) throw new Error('rubric answer missing score');
    return { score, confidence: Number.isFinite(Number(a?.confidence)) ? Number(a.confidence) : null, model: res?.model ?? null };
  }

  async execute({ force = false, limit = Infinity } = {}) {
    const max = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : Infinity;
    const forced = force === true || force === 'true';
    const seed = new Map();
    for (const r of this.#store.readMeasuredSeed() || []) seed.set(seedKey(r.show, r.season, r.episode), r);
    const gatewayOk = !!this.#gateway && typeof this.#gateway.evaluate === 'function';
    if (!gatewayOk) this.#logger.warn?.('piano.lesson-expectation.no-gateway', {});

    const lessons = await this.#source.listLessons();
    const out = { computed: 0, skipped: 0, failed: 0, remaining: 0, noCaptions: [], calibration: null };
    // Records are buffered per show and written once per show.
    let pending = { show: null, records: [] };
    const flush = () => {
      if (!pending.records.length) return;
      try {
        if (typeof this.#store.writeLessons === 'function') this.#store.writeLessons(pending.show, pending.records);
        else for (const r of pending.records) this.#store.writeLesson(pending.show, r);
      } catch (err) {
        out.failed += pending.records.length;
        out.computed -= pending.records.length;
        this.#logger.warn?.('piano.lesson-expectation.write-failed', { showKey: pending.show?.key, error: err.message });
      }
      pending = { show: null, records: [] };
    };
    let i = 0;
    for (; i < lessons.length && out.computed < max; i++) {
      const lesson = lessons[i];
      try {
        let srt = '';
        if (lesson.captionStreamId) srt = await this.#source.captionText(lesson.captionStreamId);
        const cues = parseCaptionCues(srt);
        const transcript = transcriptFor(cues);
        const captionHash = transcript ? contentHash(srt) : null;
        const measured = seed.get(seedKey(lesson.showTitle, lesson.season, lesson.episode)) || null;
        const source = measured ? 'measured' : (transcript && gatewayOk ? 'ai' : 'default');
        if (!transcript) out.noCaptions.push({ plexId: lesson.plexId, show: lesson.showTitle, title: lesson.title });

        const existing = this.#store.get(lesson.plexId);
        if (!forced && existing && existing.source === source && (existing.captionHash ?? null) === captionHash) {
          out.skipped += 1;
          this.#logger.debug?.('piano.lesson-expectation.skipped', { plexId: lesson.plexId, source });
          continue;
        }

        let rubric = null;
        if (transcript && gatewayOk) rubric = await this.#rubric(lesson, transcript);
        const lvl = rubric ? levelTarget(rubric.score, this.#levelTargets) : { level: null, targetNpm: null };
        const targetNpm = source === 'measured' ? measuredTarget(measured)
          : source === 'ai' ? lvl.targetNpm : DEFAULT_TARGET_NPM;
        const record = {
          plexId: lesson.plexId,
          title: lesson.title,
          season: lesson.season,
          episode: lesson.episode,
          durationSec: lesson.durationSec,
          seasonKey: lesson.seasonKey ?? null,
          source,
          targetNpm,
          level: lvl.level,
          levelScore: rubric ? Math.round(rubric.score * 100) / 100 : null,
          confidence: rubric?.confidence ?? null,
          model: rubric?.model ?? null,
          measured: measured ? { n: measured.n ?? null, minNpm: measured.minNpm ?? null, medianNpm: measured.medianNpm ?? null, maxNpm: measured.maxNpm ?? null } : null,
          captionHash,
          computedAt: this.#clock().toISOString(),
        };
        if (pending.show && pending.show.key !== lesson.showKey) flush();
        pending.show = { key: lesson.showKey, title: lesson.showTitle };
        pending.records.push(record);
        out.computed += 1;
        this.#logger.info?.('piano.lesson-expectation.computed', { plexId: lesson.plexId, source, level: record.level, targetNpm });
        if (!transcript) this.#logger.info?.('piano.lesson-expectation.no-captions', { plexId: lesson.plexId });
      } catch (err) {
        out.failed += 1;
        this.#logger.warn?.('piano.lesson-expectation.failed', { plexId: lesson.plexId, error: err.message });
      }
    }
    flush();
    out.remaining = lessons.length - i;
    out.calibration = this.#calibration();
    this.#logger.info?.('piano.lesson-expectation.run-summary', {
      computed: out.computed, skipped: out.skipped, failed: out.failed, remaining: out.remaining,
      noCaptions: out.noCaptions.length, ...out.calibration,
    });
    return out;
  }

  /** Agreement between the AI rubric and measured engagement, over every stored measured lesson. */
  #calibration() {
    const rows = (this.#store.all?.() || []).filter((e) => e.source === 'measured' && e.levelScore != null && e.measured?.minNpm != null);
    const rho = spearman(rows.map((e) => e.levelScore), rows.map((e) => Number(e.measured.medianNpm ?? e.measured.minNpm)));
    const above = rows.filter((e) => levelTarget(e.levelScore, this.#levelTargets).targetNpm > Number(e.measured.minNpm)).length;
    return {
      n: rows.length,
      spearman: rho == null ? null : Math.round(rho * 1000) / 1000,
      aiTargetAboveMeasuredRate: rows.length ? Math.round((above / rows.length) * 1000) / 1000 : null,
    };
  }
}

export default BuildLessonExpectations;
