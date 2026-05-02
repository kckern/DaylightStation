// backend/src/3_applications/concierge/services/ConciergePolicyEvaluator.mjs

import { matchesScope, validateGlob } from './scopeMatcher.mjs';
import { ConciergeDecision } from '../../../2_domains/concierge/ConciergeDecision.mjs';

/**
 * ConciergePolicyEvaluator — implements IConciergePolicy.evaluateToolCall with real
 * teeth. Tools self-declare `defaultPolicy` (default 'open') and optionally
 * `getScopesFor(args) → string[]`. Satellite + household config declare
 * scope-glob allow/deny lists. Deny is non-overridable downward (household
 * deny wins over satellite allow).
 *
 * The other two IConciergePolicy methods (`evaluateRequest`, `shapeResponse`)
 * remain no-op — their implementations are deferred to a later policy phase.
 */
export class ConciergePolicyEvaluator {
  #household;
  #logger;

  constructor({ householdPolicy = {}, logger = console } = {}) {
    this.#household = {
      scopes_allowed: householdPolicy.scopes_allowed ?? [],
      scopes_denied: householdPolicy.scopes_denied ?? [],
    };
    this.#logger = logger;
    // Boot-time validation. Throws on first malformed pattern.
    for (const p of this.#household.scopes_allowed) validateGlob(p);
    for (const p of this.#household.scopes_denied) validateGlob(p);
  }

  // No-op v1 — kept so PolicyEvaluator satisfies the full IConciergePolicy interface.
  evaluateRequest(_satellite, _request) { return ConciergeDecision.allow(); }
  shapeResponse(_satellite, draft) { return draft; }

  /**
   * @param {Object} satellite        - satellite descriptor with scopes_allowed/scopes_denied
   * @param {string} toolName
   * @param {Object} args             - args the LLM passed to the tool
   * @param {Object} tool             - the tool object (so we can read defaultPolicy + getScopesFor)
   * @param {string} skillName        - registering skill (used for fallback scope)
   * @returns {ConciergeDecision}
   */
  evaluateToolCall(satellite, toolName, args, tool, skillName) {
    const fallbackScope = `${skillName ?? 'unknown'}:${toolName}`;
    const scopes = this.#computeScopes(tool, args, fallbackScope);

    const satAllowed = satellite?.scopes_allowed ?? [];
    const satDenied = satellite?.scopes_denied ?? [];

    // Deny pass — household first, then satellite. Deny is absolute.
    for (const scope of scopes) {
      const hHit = this.#household.scopes_denied.find((p) => matchesScope(scope, p));
      if (hHit) return ConciergeDecision.deny(`household:${hHit}`);
      const sHit = satDenied.find((p) => matchesScope(scope, p));
      if (sHit) return ConciergeDecision.deny(`satellite:${sHit}`);
    }

    // Coverage pass — every scope must match at least one allow rule
    // (household OR satellite) to be covered. Default policy decides
    // the uncovered case.
    const allAllowed = scopes.every((scope) =>
      this.#household.scopes_allowed.some((p) => matchesScope(scope, p))
      || satAllowed.some((p) => matchesScope(scope, p)),
    );
    if (allAllowed) return ConciergeDecision.allow();

    const def = tool?.defaultPolicy ?? 'open';
    if (def === 'open') return ConciergeDecision.allow();
    // Find the first uncovered scope for a useful reason
    const uncovered = scopes.find((scope) =>
      !this.#household.scopes_allowed.some((p) => matchesScope(scope, p))
      && !satAllowed.some((p) => matchesScope(scope, p)),
    );
    return ConciergeDecision.deny(`uncovered:${uncovered}`);
  }

  #computeScopes(tool, args, fallbackScope) {
    if (typeof tool?.getScopesFor !== 'function') return [fallbackScope];
    let scopes;
    try {
      scopes = tool.getScopesFor(args);
    } catch (err) {
      this.#logger.warn?.('concierge.policy.scopes_emit_failed', { tool: tool.name, error: err.message });
      // Fail-closed: treat as fallback scope (no special access). The deny
      // path may still hit, otherwise the default-policy decides.
      return [fallbackScope];
    }
    if (!Array.isArray(scopes) || scopes.length === 0) return [fallbackScope];
    return scopes.map((s) => String(s));
  }
}

export default ConciergePolicyEvaluator;
