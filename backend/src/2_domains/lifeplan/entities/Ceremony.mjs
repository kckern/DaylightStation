export class Ceremony {
  constructor(data = {}) {
    this.type = data.type;         // unit_start | unit_end | cycle_start | cycle_retro | phase_review | season_review | era_review | emergency_retro
    this.cadence_level = data.cadence_level || null;  // unit | cycle | phase | season | era
    this.prompts = data.prompts || [];
    this.inputs = data.inputs || [];
    this.captures = data.captures || [];
  }

  toJSON() {
    return {
      type: this.type,
      cadence_level: this.cadence_level,
      prompts: this.prompts,
      inputs: this.inputs,
      captures: this.captures,
    };
  }
}
