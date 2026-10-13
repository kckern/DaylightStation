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

}
