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
import { evaluateEarnings } from '#domains/economy/earnings/index.mjs';
import { weekWindowFor } from '#domains/measures/weeklyWindow.mjs';
import { studyDayForInstant, studyDayWindowForDate } from '#domains/school/studyDay.mjs';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CONTEST_CLOSE_HOUR = 12; // Saturday noon, local

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
const EMPTY_SCHOOL = Object.freeze({ sectionDays: [], days: [], week: null, units: [] });

export class EarningsPreviewService {
  #rules;
  #school;
  #rings;
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
   * @param {() => Promise<Array<{id: string, name?: string}>>} deps.learners - the school roster
   * @param {() => Date} deps.clock
   * @param {string} deps.timezone
   * @param {number} [deps.boundaryHour=4]
   */
  constructor({ rules, schoolEvidence, ringEvidence, learners, clock, timezone, boundaryHour = 4, logger = console }) {
    if (!rules?.get) throw new Error('EarningsPreviewService requires rules');
    if (!schoolEvidence?.schoolWeek) throw new Error('EarningsPreviewService requires schoolEvidence');
    if (!ringEvidence?.standings) throw new Error('EarningsPreviewService requires ringEvidence');
    if (typeof learners !== 'function') throw new Error('EarningsPreviewService requires learners');
    if (typeof clock !== 'function') throw new Error('EarningsPreviewService requires clock');
    this.#rules = rules;
    this.#school = schoolEvidence;
    this.#rings = ringEvidence;
    this.#learners = learners;
    this.#clock = clock;
    this.#timezone = timezone ?? null;
    this.#boundaryHour = boundaryHour;
    this.#logger = logger;
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
  async roster({ week = null } = {}) {
    const roster = await this.#roster();
    const ctx = await this.#context(week, roster);
    const learners = [];
    for (const learner of roster) {
      // eslint-disable-next-line no-await-in-loop
      learners.push(await this.#price(learner, ctx));
    }
    return { windows: ctx.windows, contestClosed: ctx.contestClosed, rulesRevision: ctx.ruleset.revision, learners };
  }

  async #roster() {
    const list = await this.#learners();
    return (list ?? []).map((l) => ({ id: l.id ?? l.learnerId, name: l.name ?? l.displayName ?? l.id ?? l.learnerId }))
      .filter((l) => typeof l.id === 'string' && l.id);
  }

  #windows(week) {
    const nowMs = this.#clock().getTime();
    const day = week ?? studyDayForInstant(nowMs, { timezone: this.#timezone, boundaryHour: this.#boundaryHour });
    if (!DAY.test(day ?? '')) throw new ValidationError('week must be a study day (YYYY-MM-DD)', { code: 'INVALID_WEEK', field: 'week', value: week });
    const school = weekWindowFor(day);
    const opts = { timezone: this.#timezone };
    const fromMs = studyDayWindowForDate(school.from, { ...opts, boundaryHour: this.#boundaryHour })?.startAtMs;
    const toMs = studyDayWindowForDate(addDays(school.from, 5), { ...opts, boundaryHour: CONTEST_CLOSE_HOUR })?.startAtMs;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new ValidationError('week is not a real date', { code: 'INVALID_WEEK', field: 'week', value: week });
    return {
      school,
      rings: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
      fromMs, toMs, contestClosed: nowMs >= toMs,
    };
  }

  async #context(week, roster) {
    const w = this.#windows(week);
    const ruleset = await this.#rules.get();
    let standings = null;
    try {
      standings = await this.#rings.standings({ learnerIds: roster.map((l) => l.id), fromMs: w.fromMs, toMs: w.toMs });
    } catch (err) {
      this.#logger.warn?.('economy.earnings.rings-unavailable', { error: err?.message ?? String(err) });
    }
    return {
      ruleset, standings, contestClosed: w.contestClosed,
      windows: { school: w.school, rings: w.rings },
    };
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
    const rings = Array.isArray(ctx.standings) ? (ctx.standings.find((s) => s.learnerId === learner.id)?.rings ?? 0) : null;
    const result = evaluateEarnings({
      ruleset: ctx.ruleset,
      learnerId: learner.id,
      facts: { ...school, rings },
      standings: ctx.standings,
      contestClosed: ctx.contestClosed,
      windows: ctx.windows,
      unavailable: { school: !schoolOk },
    });
    return {
      ...result,
      learnerName: learner.name,
      contestClosed: ctx.contestClosed,
      evidence: { school: schoolOk ? 'ok' : 'unavailable', rings: Array.isArray(ctx.standings) ? 'ok' : 'unavailable' },
      // The week's work, as School reported it — the view draws it beside the prices.
      work: { days: school.days, sectionDays: school.sectionDays, week: school.week, units: school.units, rings },
    };
  }
}

export default EarningsPreviewService;
