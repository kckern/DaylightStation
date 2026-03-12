export class FeedbackEntry {
  constructor(data = {}) {
    this.date = data.date;
    this.cycle_id = data.cycle_id || null;
    this.type = data.type || 'observation';  // observation | friction | win | insight
    this.content = data.content;
    this.related_goals = data.related_goals || [];
    this.related_beliefs = data.related_beliefs || [];
    this.related_rules = data.related_rules || [];
  }

  toJSON() {
    return {
      date: this.date,
      cycle_id: this.cycle_id,
      type: this.type,
      content: this.content,
      related_goals: this.related_goals,
      related_beliefs: this.related_beliefs,
      related_rules: this.related_rules,
    };
  }
}
