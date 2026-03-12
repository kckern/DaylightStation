export class CeremonyRecord {
  constructor(data = {}) {
    this.type = data.type;
    this.date = data.date;
    this.cycle_id = data.cycle_id || null;
    this.responses = data.responses || {};
    this.observations = data.observations || [];
    this.duration_minutes = data.duration_minutes || null;
  }

  toJSON() {
    return {
      type: this.type,
      date: this.date,
      cycle_id: this.cycle_id,
      responses: this.responses,
      observations: this.observations,
      duration_minutes: this.duration_minutes,
    };
  }
}
