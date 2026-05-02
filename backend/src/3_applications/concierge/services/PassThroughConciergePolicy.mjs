import { ConciergeDecision } from '../../../2_domains/concierge/ConciergeDecision.mjs';

export class PassThroughConciergePolicy {
  evaluateRequest(_satellite, _request) { return ConciergeDecision.allow(); }
  evaluateToolCall(_satellite, _toolName, _args) { return ConciergeDecision.allow(); }
  shapeResponse(_satellite, draft) { return draft; }
}

export default PassThroughConciergePolicy;
