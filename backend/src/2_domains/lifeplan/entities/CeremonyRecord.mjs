export class CeremonyRecord {
  constructor(data = {}) {
    this.type = data.type;
    this.date = data.date;
    this.cycle_id = data.cycle_id || null;
    this.responses = data.responses || {};
    this.observations = data.observations || [];
    this.duration_minutes = data.duration_minutes || null;
  }

}
