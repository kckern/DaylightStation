/**
 * GetMilestoneStatuses — a learner's milestones with DERIVED statuses (plan
 * W3-3): passed-unit evidence joined from the work-session repo on every
 * read, never stored. With no sessions repo (lifecycle unwired) nothing is
 * "met" or "behind"-by-evidence — statuses degrade to calendar-only.
 */
import { milestoneStatus } from '#domains/school/milestones.mjs';

export class GetMilestoneStatuses {
  #store; #sessions; #clock;

  constructor({ store, sessions = null, clock = () => new Date() } = {}) {
    if (!store) throw new Error('GetMilestoneStatuses requires store');
    this.#store = store;
    this.#sessions = sessions;
    this.#clock = clock;
  }

  async execute({ learnerId } = {}) {
    const mine = this.#store.list().filter((m) => m.learnerId === learnerId);
    const rows = this.#sessions ? await this.#sessions.listForLearner(learnerId) : [];
    const passedUnitIds = new Set(rows.filter((r) => r?.result === 'passed').map((r) => r.unitId).filter(Boolean));
    const today = this.#clock().toISOString().slice(0, 10);
    return {
      milestones: mine.map((m) => ({ ...m, status: milestoneStatus(m, { passedUnitIds, today }) })),
    };
  }
}
