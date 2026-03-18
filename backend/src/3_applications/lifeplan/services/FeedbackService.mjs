import { FeedbackEntry } from '#domains/lifeplan/entities/FeedbackEntry.mjs';

export class FeedbackService {
  #lifePlanStore;

  constructor({ lifePlanStore }) {
    this.#lifePlanStore = lifePlanStore;
  }

  recordObservation(username, observation) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return;

    if (!plan.feedback) plan.feedback = [];

    const entry = new FeedbackEntry({
      date: new Date().toISOString(),
      type: observation.type || 'observation',
      content: observation.text,
      related_goals: observation.related_goals || [],
      related_beliefs: observation.related_beliefs || [],
      related_rules: observation.related_rules || [],
    });

    plan.feedback.push(entry);
    this.#lifePlanStore.save(username, plan);
  }

  getFeedback(username, period) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan?.feedback) return [];

    if (!period) return plan.feedback;

    const start = new Date(period.start);
    const end = new Date(period.end);
    end.setHours(23, 59, 59, 999);

    return plan.feedback.filter(f => {
      const ts = new Date(f.timestamp);
      return ts >= start && ts <= end;
    });
  }
}
