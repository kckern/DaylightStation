export class Purpose {
  constructor(data = {}) {
    this.statement = data.statement;
    this.adopted = data.adopted || null;
    this.last_reviewed = data.last_reviewed || null;
    this.review_cadence = data.review_cadence || 'era';
    this.notes = data.notes || null;
    this.grounded_in = data.grounded_in || { beliefs: [], values: [] };
  }

  needsReview(refutedBeliefIds) {
    const beliefs = this.grounded_in.beliefs || [];
    if (beliefs.length === 0) return false;
    return beliefs.some(b => refutedBeliefIds.includes(b.id || b));
  }

  allGroundingsRefuted(refutedBeliefIds) {
    const beliefs = this.grounded_in.beliefs || [];
    if (beliefs.length === 0) return false;
    return beliefs.every(b => refutedBeliefIds.includes(b.id || b));
  }

  toJSON() {
    return {
      statement: this.statement,
      adopted: this.adopted,
      last_reviewed: this.last_reviewed,
      review_cadence: this.review_cadence,
      notes: this.notes,
      grounded_in: this.grounded_in,
    };
  }
}
