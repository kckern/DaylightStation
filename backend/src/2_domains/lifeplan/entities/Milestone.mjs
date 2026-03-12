export class Milestone {
  constructor(data = {}) {
    this.name = data.name;
    this.completed = data.completed || false;
    this.completed_date = data.completed_date || null;
    this.target_date = data.target_date || null;
  }

  toJSON() {
    return {
      name: this.name,
      completed: this.completed,
      completed_date: this.completed_date,
      target_date: this.target_date,
    };
  }
}
