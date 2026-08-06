/**
 * GetMilestoneStatuses — a learner's milestones with DERIVED statuses (plan
 * W3-3): passed-unit evidence joined from the work-session repo on every
 * read, never stored. With no sessions repo (lifecycle unwired) nothing is
 * "met" or "behind"-by-evidence — statuses degrade to calendar-only.
 */
import { milestoneStatus } from '#domains/school/milestones.mjs';
import { offsetMinutesFor } from '#domains/school/studyDay.mjs';

export class GetMilestoneStatuses {
  #store; #sessions; #attestations; #timezone; #clock;

  constructor({ store, sessions = null, attestations = null, timezone = null, clock = () => new Date() } = {}) {
    if (!store) throw new Error('GetMilestoneStatuses requires store');
    this.#store = store;
    this.#sessions = sessions;
    this.#attestations = attestations;
    this.#timezone = timezone;
    this.#clock = clock;
  }

  async execute({ learnerId } = {}) {
    const mine = this.#store.list().filter((m) => m.learnerId === learnerId);
    const rows = this.#sessions ? await this.#sessions.listForLearner(learnerId) : [];
    // The repo's fact shape nests the verdict: `outcome.result`, never a
    // top-level `result` (the M3 review caught a join against the wrong
    // field — statuses could never reach 'met').
    const passedUnitIds = new Set(rows.filter((r) => r?.outcome?.result === 'passed').map((r) => r.unitId).filter(Boolean));
    // A teacher attestation (spec D2) counts as met — the same rule the
    // planner's gate-unlock applies.
    for (const a of this.#attestations?.list?.({ learnerId }) ?? []) passedUnitIds.add(a.unitId);
    // "Today" in the HOUSEHOLD's calendar, not UTC — a milestone must not
    // flip 'behind' at 5pm local the day before (the domain's own due-day
    // rule). Same offset source as the study-day math.
    const nowMs = this.#clock().getTime();
    const today = new Date(nowMs + offsetMinutesFor(this.#timezone, nowMs) * 60_000).toISOString().slice(0, 10);
    return {
      milestones: mine.map((m) => ({ ...m, status: milestoneStatus(m, { passedUnitIds, today }) })),
    };
  }
}
