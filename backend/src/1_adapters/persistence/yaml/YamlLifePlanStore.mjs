import path from 'path';
import { fileExists, listDirs, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';
import { LifePlan } from '#domains/lifeplan/entities/LifePlan.mjs';

const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));

const dehydratePurpose = value => pick(value, ['statement', 'adopted', 'last_reviewed', 'review_cadence', 'notes', 'grounded_in']);
const dehydrateGoal = value => pick(value, ['id', 'name', 'state', 'quality', 'why', 'sacrifice', 'deadline', 'metrics', 'audacity', 'milestones', 'state_history', 'dependencies', 'avoids_nightmare', 'nightmare_proximity', 'retrospective', 'achieved_date', 'failed_date', 'abandoned_reason', 'paused_reason', 'resume_conditions']);
const dehydrateBelief = value => pick(value, ['id', 'if', 'then', 'state', 'confidence', 'foundational', 'signals', 'evidence_history', 'evidence_quality', 'depends_on', 'state_history', 'origin']);
const dehydrateValue = value => pick(value, ['id', 'name', 'rank', 'description', 'justified_by', 'conflicts_with', 'alignment', 'drift_history']);
const dehydrateQuality = value => pick(value, ['id', 'name', 'description', 'principles', 'rules', 'grounded_in', 'shadow', 'shadow_state', 'last_shadow_check']);
const dehydrateRule = value => pick(value, ['id', 'trigger', 'action', 'quality_id', 'state', 'times_triggered', 'times_followed', 'times_helped']);
const dehydrateDependency = value => pick(value, ['type', 'blocked_goal', 'requires_goal', 'awaits_event', 'resource', 'threshold', 'current', 'status', 'reason', 'overridden']);
const dehydrateLifeEvent = value => pick(value, ['id', 'type', 'subtype', 'name', 'status', 'impact_type', 'duration_type', 'expected_date', 'actual_date', 'impact', 'resolution', 'signals', 'notes']);
const dehydrateAntiGoal = value => pick(value, ['id', 'nightmare', 'grounded_in_beliefs', 'motivates_goals', 'warning_signals', 'proximity', 'origin']);
const dehydrateCycle = value => pick(value, ['id', 'cadence_level', 'start_date', 'end_date', 'status', 'targets', 'retrospective']);
const dehydrateCeremonyRecord = value => pick(value, ['type', 'date', 'cycle_id', 'responses', 'observations', 'duration_minutes']);
const dehydrateFeedback = value => pick(value, ['date', 'cycle_id', 'type', 'content', 'related_goals', 'related_beliefs', 'related_rules']);

function dehydrateLifePlan(plan) {
  return {
    purpose: plan.purpose ? dehydratePurpose(plan.purpose) : null,
    goals: plan.goals.map(dehydrateGoal),
    beliefs: plan.beliefs.map(dehydrateBelief),
    values: plan.values.map(dehydrateValue),
    qualities: plan.qualities.map(dehydrateQuality),
    rules: plan.rules.map(dehydrateRule),
    dependencies: plan.dependencies.map(dehydrateDependency),
    life_events: plan.life_events.map(dehydrateLifeEvent),
    anti_goals: plan.anti_goals.map(dehydrateAntiGoal),
    cycles: plan.cycles.map(dehydrateCycle),
    ceremony_records: plan.ceremony_records.map(dehydrateCeremonyRecord),
    feedback: plan.feedback.map(dehydrateFeedback),
    cadence: plan.cadence,
    ceremonies: plan.ceremonies,
  };
}

import { ILifePlanRepository } from '#apps/lifeplan/ports/ILifePlanRepository.mjs';

export class YamlLifePlanStore extends ILifePlanRepository {
  #basePath;

  constructor({ basePath }) {
    super();
    this.#basePath = basePath;
  }

  load(username) {
    const filePath = this.#filePath(username);
    const data = loadYamlSafe(filePath);
    if (!data) return null;
    return new LifePlan(data);
  }

  save(username, lifePlan) {
    const filePath = this.#filePath(username);
    const data = lifePlan instanceof LifePlan ? dehydrateLifePlan(lifePlan) : lifePlan;
    saveYaml(filePath, data);
  }

  /**
   * List usernames that have a lifeplan.yml under the base path.
   * @returns {string[]}
   */
  listUsernames() {
    return listDirs(this.#basePath)
      .filter(username => fileExists(path.join(this.#basePath, username, 'lifeplan.yml')));
  }

  #filePath(username) {
    return path.join(this.#basePath, username, 'lifeplan.yml');
  }
}
