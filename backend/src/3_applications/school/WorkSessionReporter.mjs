/**
 * WorkSessionReporter — the physical console as one more program on the board
 * (spec §7.3).
 *
 * "No bespoke dashboard." The parent board already aggregates every School
 * program through `IProgramReporter`, so the work-session lifecycle registers as
 * a reporter rather than growing a view of its own. A parent sees a printed
 * worksheet in the same row shape as a language ladder.
 *
 * What it reports is deliberately small, and every field is a fact the log can
 * prove: how far through the assigned course a learner is, what is in flight,
 * and — the one thing a parent needs from this program specifically — WHETHER
 * ANYTHING IS WAITING ON THEM. Work sitting in the review queue is `blocked`
 * with a reason, because a child who handed in a sheet three days ago and heard
 * nothing has been stopped by an adult, not by the curriculum.
 *
 * The metrics here are both parent-side, and that is the contract working as
 * designed rather than an oversight: the review backlog by declaration, and
 * whole-course progress because `reporting.mjs` forces total-scope progress to
 * `parent` however it is declared (a bar that moves once a fortnight is
 * anti-feedback on a child's surface). A learner's row is therefore its headline
 * and its next step — what they can DO — which is the right shape for it.
 */
import { planLearnerWork } from '#domains/school/planner.mjs';

export class WorkSessionReporter {
  #curriculum; #sessions; #assignments; #reviewQueue; #clock; #logger;

  /**
   * @param {object} deps
   * @param {import('./CurriculumAccess.mjs').CurriculumAccess} deps.curriculum
   * @param {import('./ports/IWorkSessionRepository.mjs').IWorkSessionRepository} deps.sessions
   * @param {import('./ports/IAssignmentStore.mjs').IAssignmentStore} deps.assignments
   * @param {import('./ports/IReviewQueue.mjs').IReviewQueue} [deps.reviewQueue]
   * @param {() => Date} [deps.clock]
   * @param {object} [deps.logger]
   */
  constructor({ curriculum, sessions, assignments, reviewQueue = null, clock = () => new Date(), logger = console } = {}) {
    if (!curriculum || !sessions || !assignments) {
      throw new Error('WorkSessionReporter requires curriculum, sessions and assignments');
    }
    this.#curriculum = curriculum;
    this.#sessions = sessions;
    this.#assignments = assignments;
    this.#reviewQueue = reviewQueue;
    this.#clock = clock;
    this.#logger = logger;
  }

  get id() { return 'coursework'; }

  get label() { return 'Printed coursework'; }

  /**
   * One row per assigned course (plus one for standalone units), for one learner.
   *
   * Must not throw: `GetSchoolReport` calls every reporter, and this one failing
   * would cost the parent every other program's status.
   *
   * @param {{userId: string}} args
   * @returns {Promise<object[]>}
   */
  async summarize({ userId } = {}) {
    if (!userId) return [];
    let plan;
    let pending = [];
    try {
      const [assignment, units, history] = await Promise.all([
        this.#assignments.get(userId),
        this.#curriculum.listUnits(),
        this.#sessions.listForLearner(userId),
      ]);
      if (!assignment) return [];
      plan = planLearnerWork({
        learnerId: userId, assignment, units, sessions: history, now: this.#clock().toISOString(),
      });
      if (this.#reviewQueue) {
        pending = (await this.#reviewQueue.listPending()).filter((i) => i.learnerId === userId);
      }
    } catch (err) {
      this.#logger.warn?.('school.coursework.report-failed', { userId, error: err.message });
      return [];
    }
    if (!plan.entries.length) return [];

    const groups = new Map();
    plan.entries.forEach((entry) => {
      const key = entry.courseId ?? 'standalone';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });

    const waitingSessions = new Set(pending.map((i) => i.sessionId));
    return [...groups.entries()].map(([courseId, entries]) => this.#row(userId, courseId, entries, waitingSessions));
  }

  #row(userId, courseId, entries, waitingSessions) {
    const done = entries.filter((e) => e.status === 'completed').length;
    const inFlight = entries.filter((e) => e.status === 'in_progress');
    const waiting = inFlight.filter((e) => waitingSessions.has(e.sessionId));
    const next = inFlight[0] ?? entries.find((e) => e.status === 'available') ?? null;
    const locked = entries.find((e) => e.status === 'locked');

    const state = (() => {
      if (waiting.length) return 'blocked';
      if (done === entries.length) return 'complete';
      if (inFlight.length) return 'active';
      if (next) return 'active';
      // Nothing done, nothing open, nothing available — everything is gated.
      return locked ? 'blocked' : 'not-started';
    })();

    const nextStep = (() => {
      if (waiting.length) {
        // The child sees the SAME wait the teacher's queue shows (student-
        // advocacy A1): since when, not just "waiting".
        const since = waiting[0].updatedAt ? ` since ${String(waiting[0].updatedAt).slice(0, 10)}` : '';
        return {
          label: `Check ${waiting[0].title}`,
          detail: `Handed in${since} — waiting for a grown-up to mark it.`,
          blocked: true,
          blockedReason: `Waiting on a grown-up to mark it${since}`,
        };
      }
      if (next) return { label: next.title, detail: next.status === 'in_progress' ? 'In progress' : 'Ready to start' };
      if (locked) {
        return { label: locked.title, blocked: true, blockedReason: locked.lockReason ?? 'Locked' };
      }
      return null;
    })();

    return {
      program: this.id,
      instanceId: courseId,
      label: courseId === 'standalone' ? 'Set work' : courseId,
      userId,
      state,
      lastActivity: null,
      headline: `${done} of ${entries.length} done`,
      next: nextStep,
      metrics: [
        { id: 'units', kind: 'progress', label: 'Units finished', value: done, total: entries.length, unit: 'units', scope: 'total' },
        ...(waiting.length
          ? [{ id: 'awaiting-review', kind: 'count', label: 'Waiting to be marked', value: waiting.length, unit: 'sheets', audience: 'parent' }]
          : []),
      ],
    };
  }
}

export default WorkSessionReporter;
