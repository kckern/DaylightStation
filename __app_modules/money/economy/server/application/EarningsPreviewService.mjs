/**
 * What each learner's week is worth under the household earn rules — a
 * PREVIEW: it reads evidence and prices it, and writes nothing to any ledger.
 *
 * Two windows (taxonomy D10):
 *   school week     Monday → Sunday study days (term grid, sessions)
 *   ring award week Monday 04:00 → Saturday 12:00 local (the contest closes Saturday noon)
 *
 * Evidence comes through ports the producing contexts implement (School,
 * Fitness); a source that fails makes its lines indeterminate, never zero.
 * Reusable by any surface — teacher console, fitness, admin — through
 * `preview` (one learner) and `roster` (everyone, one standings read).
 */
import { evaluateEarnings } from "../domain/earnings/index.mjs";
import { weekWindowFor } from "../../../../learning/school/server/study-calendar.mjs";
import { studyDayForInstant, studyDayWindowForDate } from "../../../../learning/school/server/domain-study-day.mjs";
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ACHIEVEMENT_KINDS = new Set(['activity-days', 'activity-contest', 'milestone']);
const ACHIEVEMENT_TTL_MS = 60_000;
const CONTEST_CLOSE_HOUR = 12; // Saturday noon, local

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const EMPTY_SCHOOL = Object.freeze({ sectionDays: [], days: [], week: null, units: [], debriefs: [] });

export class EarningsPreviewService {
  #rules;
  #school;
  #rings;
  #achievements;
  #achievementCache = new Map(); // weekId → {at, promise}: polled surfaces share one read a minute
  #learners;
  #clock;
  #timezone;
  #boundaryHour;
  #logger;

  /**
   * @param {object} deps
   * @param {{get: () => Promise<object>}} deps.rules - EarnRulesService (or anything with get())
   * @param {import('./ports/IEarningEvidenceSource.mjs').ISchoolEarningEvidence} deps.schoolEvidence
   * @param {import('./ports/IEarningEvidenceSource.mjs').IRingEvidence} deps.ringEvidence
   * @param {import('./ports/IEarningEvidenceSource.mjs').IAchievementEvidence|null} [deps.achievementEvidence]
   * @param {() => Promise<Array<{id: string, name?: string}>>} deps.learners - the school roster
   * @param {() => Date} deps.clock
   * @param {string} deps.timezone
   * @param {number} [deps.boundaryHour=4]
   */
  constructor({ rules, schoolEvidence, ringEvidence, achievementEvidence = null, learners, clock, timezone, boundaryHour = 4, logger = console }) {
    if (!rules?.get) throw new Error('EarningsPreviewService requires rules');
    if (!schoolEvidence?.schoolWeek) throw new Error('EarningsPreviewService requires schoolEvidence');
    if (!ringEvidence?.standings) throw new Error('EarningsPreviewService requires ringEvidence');
    if (typeof learners !== 'function') throw new Error('EarningsPreviewService requires learners');
    if (typeof clock !== 'function') throw new Error('EarningsPreviewService requires clock');
    this.#rules = rules;
    this.#school = schoolEvidence;
    this.#rings = ringEvidence;
    this.#achievements = achievementEvidence?.week ? achievementEvidence : null;
    this.#learners = learners;
    this.#clock = clock;
    this.#timezone = timezone ?? null;
    this.#boundaryHour = boundaryHour;
    this.#logger = logger;
  }

  /** Today's study day: what `week: null` resolves to (clock, timezone, boundary hour). */
  currentStudyDay() {
    return studyDayForInstant(this.#clock().getTime(), { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
  }

  /** One learner's week. `week` is any study day inside it (default: today's). */
  async preview({ learnerId, week = null } = {}) {
    const roster = await this.#roster();
    const learner = roster.find((l) => l.id === learnerId);
    if (!learner) throw new EntityNotFoundError('learner', learnerId);
    const ctx = await this.#context(week, roster);
    return this.#price(learner, ctx);
  }

  /** Every learner's week, reading the rules and the ring standings once. */
  async roster({ week = null, fresh = false } = {}) {
    const roster = await this.#roster();
    const ctx = await this.#context(week, roster, { fresh });
    // In parallel: each learner's evidence is an independent read, and a
    // serial roster took seconds per learner on a cold verdict cache.
    const learners = await Promise.all(roster.map((learner) => this.#price(learner, ctx)));
    return { windows: ctx.windows, contestClosed: ctx.contestClosed, rulesRevision: ctx.ruleset.revision, today: ctx.today, learners };
  }

  async #roster() {
    const list = await this.#learners();
    return (list ?? []).map((l) => ({ id: l.id ?? l.learnerId, name: l.name ?? l.displayName ?? l.id ?? l.learnerId }))
      .filter((l) => typeof l.id === 'string' && l.id);
  }

  #windows(week) {
    const nowMs = this.#clock().getTime();
    const day = week ?? this.currentStudyDay();
    if (!DAY.test(day ?? '')) throw new ValidationError('week must be a study day (YYYY-MM-DD)', { code: 'INVALID_WEEK', field: 'week', value: week });
    const school = weekWindowFor(day);
    const opts = { timezone: this.#timezone };
    const fromMs = studyDayWindowForDate(school.from, { ...opts, boundaryHour: this.#boundaryHour })?.startAtMs;
    const toMs = studyDayWindowForDate(addDays(school.from, 5), { ...opts, boundaryHour: CONTEST_CLOSE_HOUR })?.startAtMs;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new ValidationError('week is not a real date', { code: 'INVALID_WEEK', field: 'week', value: week });
    const schoolEndMs = studyDayWindowForDate(addDays(school.to, 1), { ...opts, boundaryHour: this.#boundaryHour })?.startAtMs;
    return {
      school,
      rings: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      fromMs, toMs, contestClosed: nowMs >= toMs, schoolEndMs,
      today: studyDayForInstant(nowMs, { timezone: this.#timezone, boundaryHour: this.#boundaryHour }),
    };
  }

  async #context(week, roster, { fresh = false } = {}) {
    const w = this.#windows(week);
    const ruleset = await this.#rules.get();
    let standings = null;
    try {
      standings = await this.#rings.standings({ learnerIds: roster.map((l) => l.id), fromMs: w.fromMs, toMs: w.toMs });
    } catch (err) {
      this.#logger.warn?.('economy.earnings.rings-unavailable', { error: err?.message ?? String(err) });
    }
    let achievements = null;
    if (this.#achievements && ruleset.rules.some((r) => ACHIEVEMENT_KINDS.has(r.kind))) {
      try {
        achievements = await this.#cachedAchievements(w, roster, { fresh });
      } catch (err) {
        this.#logger.warn?.('economy.gems.evidence-unavailable', { source: 'all', error: err?.message ?? String(err) });
      }
    }
    return {
      ruleset, standings, contestClosed: w.contestClosed, today: w.today, achievements,
      windows: { school: w.school, rings: w.rings },
    };
  }

  /**
   * The week's achievement evidence, shared for a minute so polled surfaces
   * (fitness standings, the school board) cost one read a minute. `fresh`
   * skips the shared copy and replaces it: a person just opened the Gem Board,
   * or a race just landed, and a minute-old read would miss it (2026-11-04: a
   * race-of-the-week lead did not show until the page was reloaded).
   */
  #cachedAchievements(w, roster, { fresh = false } = {}) {
    const key = `${w.school.from}|${roster.map((l) => l.id).join(',')}`;
    const nowMs = this.#clock().getTime();
    const hit = this.#achievementCache.get(key);
    if (!fresh && hit && nowMs - hit.at < ACHIEVEMENT_TTL_MS) return hit.promise;
    const promise = this.#readAchievements(w, roster);
    this.#achievementCache.set(key, { at: nowMs, promise });
    promise.catch(() => this.#achievementCache.delete(key));
    for (const [k, v] of this.#achievementCache) if (nowMs - v.at >= ACHIEVEMENT_TTL_MS) this.#achievementCache.delete(k);
    return promise;
  }

  async #readAchievements(w, roster) {
    return this.#achievements.week({
      learnerIds: roster.map((l) => l.id),
      week: w.school,
      schoolMs: { fromMs: w.fromMs, toMs: w.schoolEndMs },
      ringMs: { fromMs: w.fromMs, toMs: w.toMs },
      contestClosed: w.contestClosed,
      today: w.today,
      studyDay: (ms) => studyDayForInstant(ms, { timezone: this.#timezone, boundaryHour: this.#boundaryHour }),
    });
  }

  /**
   * Finished workouts summed per study day (by start, 4 am boundary) — what a
   * ring-days rule counts. A running workout, or one still inside its resume
   * window, waits: a day it would move is not moved until it is final.
   */
  #ringDays(sessions) {
    const byDay = new Map();
    for (const s of sessions) {
      if (!s?.final || !Number.isFinite(s.rings) || s.rings <= 0 || !Number.isFinite(s.startMs)) continue;
      const day = studyDayForInstant(s.startMs, { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
      byDay.set(day, (byDay.get(day) ?? 0) + s.rings);
    }
    return [...byDay].map(([day, rings]) => ({ day, rings })).sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  async #price(learner, ctx) {
    let school = EMPTY_SCHOOL;
    let schoolOk = true;
    try {
      school = { ...EMPTY_SCHOOL, ...(await this.#school.schoolWeek({ learnerId: learner.id, week: ctx.windows.school })) };
    } catch (err) {
      schoolOk = false;
      this.#logger.warn?.('economy.earnings.school-unavailable', { learnerId: learner.id, error: err?.message ?? String(err) });
    }
    const standing = Array.isArray(ctx.standings) ? ctx.standings.find((s) => s.learnerId === learner.id) : null;
    const rings = Array.isArray(ctx.standings) ? (standing?.rings ?? 0) : null;
    const ringSessions = Array.isArray(standing?.sessions) ? standing.sessions : [];
    const ringDays = Array.isArray(ctx.standings) ? this.#ringDays(ringSessions) : null;
    const outsideTerm = schoolOk && school.coverage === 'outside-term';
    const result = evaluateEarnings({
      ruleset: ctx.ruleset,
      learnerId: learner.id,
      facts: {
        ...school, rings, ringSessions, ringDays,
        achievements: ctx.achievements
          ? { ...(ctx.achievements.learners?.[learner.id] ?? { days: {}, milestones: {} }), unavailable: ctx.achievements.unavailable ?? [] }
          : null,
      },
      standings: ctx.standings,
      contests: ctx.achievements?.contests ?? null,
      contestClosed: ctx.contestClosed,
      windows: ctx.windows,
      today: ctx.today,
      unavailable: { school: !schoolOk ? true : (outsideTerm ? 'outside-term' : false) },
    });
    return {
      ...result,
      learnerName: learner.name,
      contestClosed: ctx.contestClosed,
      today: ctx.today,
      evidence: {
        school: !schoolOk ? 'unavailable' : (outsideTerm ? 'outside-term' : 'ok'),
        rings: Array.isArray(ctx.standings) ? 'ok' : 'unavailable',
      },
      // The week's work, as School reported it — the view draws it beside the prices.
      work: { days: school.days, sectionDays: school.sectionDays, week: school.week, units: school.units, debriefs: school.debriefs, rings },
    };
  }
}

export default EarningsPreviewService;
