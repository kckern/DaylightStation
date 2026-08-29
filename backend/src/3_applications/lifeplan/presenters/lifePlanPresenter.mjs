const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));

export const presentPurpose = value => pick(value, ['statement', 'adopted', 'last_reviewed', 'review_cadence', 'notes', 'grounded_in']);
export const presentGoal = value => pick(value, ['id', 'name', 'state', 'quality', 'why', 'sacrifice', 'deadline', 'metrics', 'audacity', 'milestones', 'state_history', 'dependencies', 'avoids_nightmare', 'nightmare_proximity', 'retrospective', 'achieved_date', 'failed_date', 'abandoned_reason', 'paused_reason', 'resume_conditions']);
export const presentBelief = value => pick(value, ['id', 'if', 'then', 'state', 'confidence', 'foundational', 'signals', 'evidence_history', 'evidence_quality', 'depends_on', 'state_history', 'origin']);
export const presentValue = value => pick(value, ['id', 'name', 'rank', 'description', 'justified_by', 'conflicts_with', 'alignment', 'drift_history']);
export const presentQuality = value => pick(value, ['id', 'name', 'description', 'principles', 'rules', 'grounded_in', 'shadow', 'shadow_state', 'last_shadow_check']);
export const presentRule = value => pick(value, ['id', 'trigger', 'action', 'quality_id', 'state', 'times_triggered', 'times_followed', 'times_helped']);
export const presentDependency = value => pick(value, ['type', 'blocked_goal', 'requires_goal', 'awaits_event', 'resource', 'threshold', 'current', 'status', 'reason', 'overridden']);
export const presentLifeEvent = value => pick(value, ['id', 'type', 'subtype', 'name', 'status', 'impact_type', 'duration_type', 'expected_date', 'actual_date', 'impact', 'resolution', 'signals', 'notes']);
export const presentAntiGoal = value => pick(value, ['id', 'nightmare', 'grounded_in_beliefs', 'motivates_goals', 'warning_signals', 'proximity', 'origin']);
export const presentCycle = value => pick(value, ['id', 'cadence_level', 'start_date', 'end_date', 'status', 'targets', 'retrospective']);
export const presentCeremonyRecord = value => pick(value, ['type', 'date', 'cycle_id', 'responses', 'observations', 'duration_minutes']);
export const presentFeedback = value => pick(value, ['date', 'cycle_id', 'type', 'content', 'related_goals', 'related_beliefs', 'related_rules']);

export function presentLifePlan(plan) {
  return {
    purpose: plan.purpose ? presentPurpose(plan.purpose) : null,
    goals: (plan.goals || []).map(presentGoal),
    beliefs: (plan.beliefs || []).map(presentBelief),
    values: (plan.values || []).map(presentValue),
    qualities: (plan.qualities || []).map(presentQuality),
    rules: (plan.rules || []).map(presentRule),
    dependencies: (plan.dependencies || []).map(presentDependency),
    life_events: (plan.life_events || []).map(presentLifeEvent),
    anti_goals: (plan.anti_goals || []).map(presentAntiGoal),
    cycles: (plan.cycles || []).map(presentCycle),
    ceremony_records: (plan.ceremony_records || []).map(presentCeremonyRecord),
    feedback: (plan.feedback || []).map(presentFeedback),
    cadence: plan.cadence,
    ceremonies: plan.ceremonies,
  };
}
