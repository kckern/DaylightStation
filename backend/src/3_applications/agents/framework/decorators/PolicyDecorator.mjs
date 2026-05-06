/**
 * policyDecorator — ToolDecorator that gates execution through context.policy.
 *
 * When context.policy is null/absent, returns the tool unchanged (pass-through).
 * This ensures health-coach and other non-policy agents are not affected.
 *
 * The decorator reads `tool.defaultPolicy` and `tool.getScopesFor` (concierge-
 * specific optional fields) and passes them to evaluateToolCall — the policy
 * implementation decides how to use them. Plain tools that lack these fields
 * still work: evaluateToolCall receives `undefined` for the fields and the
 * ConciergePolicyEvaluator treats missing `getScopesFor` as a fallback scope.
 *
 * @type {import('./ToolDecorator.mjs').ToolDecorator}
 */
export function policyDecorator(tool, context) {
  const policy = context?.policy ?? null;

  // No policy in context — strict pass-through. Do not wrap.
  if (!policy) return tool;

  const satellite = context.satellite ?? null;

  return {
    ...tool,
    execute: async (params, callCtx) => {
      const transcript = (callCtx ?? context)?.transcript ?? context?.transcript ?? null;
      const decision = policy.evaluateToolCall(
        satellite,
        tool.name,
        params,
        tool,
        null,   // skillName — not tracked at decorator level; policy uses fallback scope
      );

      if (!decision.allow) {
        const denied = {
          ok: false,
          reason: `policy_denied:${decision.reason ?? 'unspecified'}`,
        };
        transcript?.recordTool({
          name: tool.name,
          args: params,
          result: denied,
          ok: false,
          latencyMs: 0,
          policyDecision: { allowed: false, reason: decision.reason ?? null },
        });
        return denied;
      }

      // Allowed — let the next decorator (TranscriptRecorder → inner execute) run.
      return tool.execute(params, callCtx);
    },
  };
}

export default policyDecorator;
