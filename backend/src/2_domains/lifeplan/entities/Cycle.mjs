export class Cycle {
  constructor(data = {}) {
    this.id = data.id;
    this.cadence_level = data.cadence_level;  // unit | cycle | phase | season | era
    this.start_date = data.start_date;
    this.end_date = data.end_date || null;
    this.status = data.status || 'active';    // active | completed
    this.targets = data.targets || [];
    this.retrospective = data.retrospective || null;
  }

  isActive() {
    return this.status === 'active';
  }

}
