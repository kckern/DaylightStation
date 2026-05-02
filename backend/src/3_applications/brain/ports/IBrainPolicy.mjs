/**
 * IBrainPolicy
 *   evaluateRequest(satellite, request): BrainDecision
 *   evaluateToolCall(satellite, toolName, args): BrainDecision
 *   shapeResponse(satellite, draftText): string
 */
export function isBrainPolicy(obj) {
  return !!obj
    && typeof obj.evaluateRequest === 'function'
    && typeof obj.evaluateToolCall === 'function'
    && typeof obj.shapeResponse === 'function';
}

export function assertBrainPolicy(obj) {
  if (!isBrainPolicy(obj)) throw new Error('Object does not implement IBrainPolicy');
}

export default { isBrainPolicy, assertBrainPolicy };
