export class Rule {
  constructor(data = {}) {
    this.id = data.id;
    this.trigger = data.trigger;
    this.action = data.action;
    this.quality_id = data.quality_id || null;
    this.state = data.state || 'defined';
    this.times_triggered = data.times_triggered || 0;
    this.times_followed = data.times_followed || 0;
    this.times_helped = data.times_helped || 0;
  }

  /**
   * Effectiveness is DERIVED from the counts; it is never stored. Quality
   * rules are persisted as plain objects, so readers go through this rather
   * than a (nonexistent) `effectiveness` field.
   * @param {Object} data - a rule, entity or plain object
   * @returns {'untested'|'effective'|'not_followed'|'ineffective'|'mixed'}
   */
  static effectivenessOf(data) {
    return new Rule(data || {}).evaluateEffectiveness();
  }

  evaluateEffectiveness() {
    if (this.times_triggered === 0) return 'untested';
    const followRate = this.times_followed / this.times_triggered;
    const helpRate = this.times_followed > 0
      ? this.times_helped / this.times_followed
      : 0;

    if (followRate >= 0.7 && helpRate >= 0.7) return 'effective';
    if (followRate < 0.5) return 'not_followed';
    if (helpRate < 0.5) return 'ineffective';
    return 'mixed';
  }

  recordTrigger({ followed, helped }) {
    this.times_triggered++;
    if (followed) this.times_followed++;
    if (followed && helped) this.times_helped++;
    if (this.state === 'defined') this.state = 'tested';
  }

}
