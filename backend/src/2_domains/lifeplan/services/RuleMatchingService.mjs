/**
 * Matches rules to situations based on trigger conditions.
 * Records follow/help outcomes for effectiveness tracking.
 */
export class RuleMatchingService {
  getApplicableRules(qualities, context) {
    const rules = [];
    for (const q of (qualities || [])) {
      for (const r of (q.rules || [])) {
        if (this.#matchesTrigger(r, context)) {
          rules.push({ ...r, quality_id: q.id, quality_name: q.name });
        }
      }
    }
    return rules;
  }

  recordOutcome(rule, outcome) {
    rule.times_triggered = (rule.times_triggered || 0) + 1;
    if (outcome.followed) {
      rule.times_followed = (rule.times_followed || 0) + 1;
      if (outcome.helped) {
        rule.times_helped = (rule.times_helped || 0) + 1;
      }
    }
  }

  getEffectiveness(rule) {
    if (!rule.times_triggered || rule.times_triggered === 0) return 'untested';
    const followRate = (rule.times_followed || 0) / rule.times_triggered;
    const helpRate = rule.times_followed > 0 ? (rule.times_helped || 0) / rule.times_followed : 0;
    if (followRate >= 0.7 && helpRate >= 0.7) return 'effective';
    if (followRate < 0.5) return 'not_followed';
    if (helpRate < 0.5) return 'ineffective';
    return 'mixed';
  }

  #matchesTrigger(rule, context) {
    if (!rule.trigger || !context) return false;
    const trigger = rule.trigger.toLowerCase();
    const tags = (context.tags || []).map(t => t.toLowerCase());
    const situation = (context.situation || '').toLowerCase();
    return tags.some(t => trigger.includes(t)) || situation.includes(trigger) || trigger.includes(situation);
  }
}
