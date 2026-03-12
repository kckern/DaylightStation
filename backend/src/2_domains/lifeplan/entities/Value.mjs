import { AlignmentState } from '../value-objects/AlignmentState.mjs';

export class Value {
  constructor(data = {}) {
    this.id = data.id;
    this.name = data.name;
    this.rank = data.rank ?? null;
    this.description = data.description || null;
    this.justified_by = data.justified_by || [];
    this.conflicts_with = data.conflicts_with || [];
    this.alignment = data.alignment || 'aligned';
    this.drift_history = data.drift_history || [];
  }

  isAxiomatic() {
    return this.justified_by.length === 0;
  }

  allJustificationsRefuted(refutedBeliefIds) {
    if (this.isAxiomatic()) return false;
    return this.justified_by.every(j => refutedBeliefIds.includes(j.belief || j));
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      rank: this.rank,
      description: this.description,
      justified_by: this.justified_by,
      conflicts_with: this.conflicts_with,
      alignment: this.alignment,
      drift_history: this.drift_history,
    };
  }
}
