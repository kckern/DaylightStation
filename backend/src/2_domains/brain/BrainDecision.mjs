export class BrainDecision {
  constructor({ allow, reason = null }) {
    this.allow = !!allow;
    this.reason = reason;
    Object.freeze(this);
  }
  static allow() { return new BrainDecision({ allow: true }); }
  static deny(reason) { return new BrainDecision({ allow: false, reason }); }
}

export default BrainDecision;
