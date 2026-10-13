export class ConciergeDecision {
  constructor({ allow, reason = null }) {
    this.allow = !!allow;
    this.reason = reason;
    Object.freeze(this);
  }
  static allow() { return new ConciergeDecision({ allow: true }); }
  static deny(reason) { return new ConciergeDecision({ allow: false, reason }); }
}

export default ConciergeDecision;
