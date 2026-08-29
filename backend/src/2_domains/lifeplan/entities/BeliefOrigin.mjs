export class BeliefOrigin {
  constructor(data = {}) {
    this.type = data.type;  // experience | observation | teaching | culture | reasoning | trauma
    this.description = data.description || null;
    this.narrative = data.narrative || null;
    this.source_events = data.source_events || [];
  }

}
