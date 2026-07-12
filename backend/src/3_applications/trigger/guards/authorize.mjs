/**
 * Authorize stage. Runs an ordered strategy list (first denial wins); default
 * (no strategies) approves. Gatekeeper strategies are wired in Plan 3.
 * Layer: APPLICATION.
 * @module applications/trigger/guards/authorize
 */
export async function authorize({ strategies = [], context = {} } = {}) {
  for (const strategy of strategies) {
    const result = await strategy.evaluate(context);
    if (result && result.approved === false) return { approved: false, reason: result.reason };
  }
  return { approved: true };
}
export default authorize;
