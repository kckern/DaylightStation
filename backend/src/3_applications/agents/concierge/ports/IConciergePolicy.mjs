/**
 * IConciergePolicy
 *   evaluateRequest(satellite, request): ConciergeDecision
 *   evaluateToolCall(satellite, toolName, args): ConciergeDecision
 *   shapeResponse(satellite, draftText): string
 */
export function isConciergePolicy(obj) {
  return !!obj
    && typeof obj.evaluateRequest === 'function'
    && typeof obj.evaluateToolCall === 'function'
    && typeof obj.shapeResponse === 'function';
}

export function assertConciergePolicy(obj) {
  if (!isConciergePolicy(obj)) throw new Error('Object does not implement IConciergePolicy');
}

export default { isConciergePolicy, assertConciergePolicy };
