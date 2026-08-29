import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';
import { Goal } from '#domains/lifeplan/entities/Goal.mjs';
import { Value } from '#domains/lifeplan/entities/Value.mjs';
import { Belief } from '#domains/lifeplan/entities/Belief.mjs';
import { Purpose } from '#domains/lifeplan/entities/Purpose.mjs';

/**
 * Slug an id from a display name. Lowercase, alnum-hyphen, trimmed, capped.
 */
const slug = (s) =>
  String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

const serializeGoal = goal => ({ id: goal.id, name: goal.name, state: goal.state, quality: goal.quality, why: goal.why, sacrifice: goal.sacrifice, deadline: goal.deadline, metrics: goal.metrics, audacity: goal.audacity, milestones: goal.milestones, state_history: goal.state_history, dependencies: goal.dependencies, avoids_nightmare: goal.avoids_nightmare, nightmare_proximity: goal.nightmare_proximity, retrospective: goal.retrospective, achieved_date: goal.achieved_date, failed_date: goal.failed_date, abandoned_reason: goal.abandoned_reason, paused_reason: goal.paused_reason, resume_conditions: goal.resume_conditions });
const serializeValue = value => ({ id: value.id, name: value.name, rank: value.rank, description: value.description, justified_by: value.justified_by, conflicts_with: value.conflicts_with, alignment: value.alignment, drift_history: value.drift_history });
const serializeBelief = belief => ({ id: belief.id, if: belief.if, then: belief.then, state: belief.state, confidence: belief.confidence, foundational: belief.foundational, signals: belief.signals, evidence_history: belief.evidence_history, evidence_quality: belief.evidence_quality, depends_on: belief.depends_on, state_history: belief.state_history, origin: belief.origin });
const serializePurpose = purpose => ({ statement: purpose.statement, adopted: purpose.adopted, last_reviewed: purpose.last_reviewed, review_cadence: purpose.review_cadence, notes: purpose.notes, grounded_in: purpose.grounded_in });

/**
 * PlanAuthoringService — the single write path for creating a life plan and
 * appending its top-level entities (goals, values, beliefs, purpose).
 *
 * Shared by the REST authoring routes (Task C1) and, later, the coach's write
 * tools (Task C2). Genesis creates a minimal valid plan; each authoring method
 * creates-if-missing then appends a domain-shaped entity and saves.
 */
export class PlanAuthoringService {
  #lifePlanStore;

  constructor({ lifePlanStore }) {
    this.#lifePlanStore = lifePlanStore;
  }

  /**
   * Create a fresh, minimal-but-valid plan. Refuses to clobber an existing one.
   * @returns {LifePlan}
   */
  createPlan(username) {
    if (this.#lifePlanStore.load(username)) {
      throw new Error(`Plan already exists for ${username}`);
    }
    const plan = new LifePlan({});
    this.#lifePlanStore.save(username, plan);
    return plan;
  }

  /**
   * Load the user's plan, creating and persisting a minimal one if absent.
   * @returns {LifePlan}
   */
  #loadOrCreate(username) {
    const existing = this.#lifePlanStore.load(username);
    if (existing) return existing;
    const plan = new LifePlan({});
    this.#lifePlanStore.save(username, plan);
    return this.#lifePlanStore.load(username) || plan;
  }

  #uniqueId(base, existing) {
    const b = slug(base) || 'item';
    let id = b;
    let n = 2;
    while (existing.some((e) => e.id === id)) id = `${b}-${n++}`;
    return id;
  }

  /**
   * Append a goal (initial state = Goal default 'dream').
   * @returns {object} the created goal record
   */
  addGoal(username, { name, why = '', milestone = null } = {}) {
    if (!name) throw new Error('Goal requires a name');
    const plan = this.#loadOrCreate(username);
    const goal = new Goal({
      id: this.#uniqueId(name, plan.goals),
      name,
      why: why || null,
      milestones: milestone ? [{ name: milestone, completed: false }] : [],
    });
    plan.goals.push(goal);
    this.#lifePlanStore.save(username, plan);
    return serializeGoal(goal);
  }

  /**
   * Append a value at the next rank (1-based).
   * @returns {object} the created value record
   */
  addValue(username, { name, description = '' } = {}) {
    if (!name) throw new Error('Value requires a name');
    const plan = this.#loadOrCreate(username);
    const value = new Value({
      id: this.#uniqueId(name, plan.values),
      name,
      rank: plan.values.length + 1,
      description: description || null,
    });
    plan.values.push(value);
    this.#lifePlanStore.save(username, plan);
    return serializeValue(value);
  }

  /**
   * Append a belief (initial state = Belief default 'hypothesized',
   * confidence default 0.5). Body uses if_hypothesis/then_outcome, mapped to
   * the domain's if/then fields.
   * @returns {object} the created belief record
   */
  addBelief(username, { if_hypothesis, then_outcome } = {}) {
    if (!if_hypothesis || !then_outcome) {
      throw new Error('Belief requires if_hypothesis and then_outcome');
    }
    const plan = this.#loadOrCreate(username);
    const belief = new Belief({
      id: this.#uniqueId(if_hypothesis, plan.beliefs),
      if: if_hypothesis,
      then: then_outcome,
    });
    plan.beliefs.push(belief);
    this.#lifePlanStore.save(username, plan);
    return serializeBelief(belief);
  }

  /**
   * Set or replace the plan's purpose statement.
   * @returns {object} the purpose record
   */
  setPurpose(username, { statement } = {}) {
    if (!statement) throw new Error('Purpose requires a statement');
    const plan = this.#loadOrCreate(username);
    plan.purpose = new Purpose({
      ...(plan.purpose ? serializePurpose(plan.purpose) : {}),
      statement,
    });
    this.#lifePlanStore.save(username, plan);
    return serializePurpose(plan.purpose);
  }
}
