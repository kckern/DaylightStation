export class Shadow {
  constructor(data = {}) {
    this.name = data.name;
    this.description = data.description || null;
    this.enabling_belief = data.enabling_belief || null;
    this.warning_signals = data.warning_signals || [];
    this.countermeasures = data.countermeasures || [];
  }

}
