export class AntiGoal {
  constructor(data = {}) {
    this.id = data.id;
    this.nightmare = data.nightmare;
    this.grounded_in_beliefs = data.grounded_in_beliefs || [];
    this.motivates_goals = data.motivates_goals || [];
    this.warning_signals = data.warning_signals || [];
    this.proximity = data.proximity || 'distant'; // distant | approaching | imminent
    this.origin = data.origin || null;
  }

  toJSON() {
    return {
      id: this.id,
      nightmare: this.nightmare,
      grounded_in_beliefs: this.grounded_in_beliefs,
      motivates_goals: this.motivates_goals,
      warning_signals: this.warning_signals,
      proximity: this.proximity,
      origin: this.origin,
    };
  }
}
