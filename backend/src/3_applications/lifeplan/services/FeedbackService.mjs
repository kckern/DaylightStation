export class FeedbackService {
  #lifePlanStore;

  constructor({ lifePlanStore }) {
    this.#lifePlanStore = lifePlanStore;
  }

  recordObservation(username, observation) {
    const plan = this.#lifePlanStore.load(username);
    if (!plan) return;

    if (!plan.feedback) plan.feedback = [];

    const entry = {
      text: observation.text,
      sentiment: observation.sentiment,
      timestamp: new Date().toISOString(),
    };

    if (observation.element_type) entry.element_type = observation.element_type;
    if (observation.element_id) entry.element_id = observation.element_id;
    if (observation.tags) entry.tags = observation.tags;

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
