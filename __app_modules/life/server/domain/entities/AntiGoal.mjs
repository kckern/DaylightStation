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

}
