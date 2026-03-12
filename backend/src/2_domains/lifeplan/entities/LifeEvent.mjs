export class LifeEvent {
  constructor(data = {}) {
    this.id = data.id;
    this.type = data.type;               // family | career | location | education | health | financial
    this.subtype = data.subtype || null;
    this.name = data.name;
    this.status = data.status || 'anticipated'; // anticipated | occurred | cancelled
    this.impact_type = data.impact_type;  // blocks | derails | invalidates | transforms | cascades
    this.duration_type = data.duration_type || 'indefinite'; // temporary | indefinite | permanent
    this.expected_date = data.expected_date || null;
    this.actual_date = data.actual_date || null;
    this.impact = data.impact || {};
    this.resolution = data.resolution || null;
    this.signals = data.signals || [];
    this.notes = data.notes || null;
  }

  hasOccurred() {
    return this.status === 'occurred';
  }

  isPermanent() {
    return this.duration_type === 'permanent';
  }

  toJSON() {
    return {
      id: this.id,
      type: this.type,
      subtype: this.subtype,
      name: this.name,
      status: this.status,
      impact_type: this.impact_type,
      duration_type: this.duration_type,
      expected_date: this.expected_date,
      actual_date: this.actual_date,
      impact: this.impact,
      resolution: this.resolution,
      signals: this.signals,
      notes: this.notes,
    };
  }
}
