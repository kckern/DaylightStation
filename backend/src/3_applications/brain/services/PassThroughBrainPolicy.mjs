import { BrainDecision } from '../../../2_domains/brain/BrainDecision.mjs';

export class PassThroughBrainPolicy {
  evaluateRequest(_satellite, _request) { return BrainDecision.allow(); }
  evaluateToolCall(_satellite, _toolName, _args) { return BrainDecision.allow(); }
  shapeResponse(_satellite, draft) { return draft; }
}

export default PassThroughBrainPolicy;
