import { validateWorkRef } from './workModel.mjs';
const flowKeys = new Set(['flowType', 'offerId', 'step', 'selectionRefs', 'pageCursor', 'expectedVersion', 'policyRevision', 'sourceReceipt', 'knowledgeReviewIds']);
export function validateWorkFlowState(flow) {
  try {
    return !!flow && typeof flow === 'object' && !Array.isArray(flow) && Object.keys(flow).every(key => flowKeys.has(key)) && ['match', 'tasks', 'projects', 'create_task', 'create_container', 'correction'].includes(flow.flowType) && typeof flow.offerId === 'string' && flow.offerId.length <= 256 && typeof flow.step === 'string' && flow.step.length <= 64 && Array.isArray(flow.selectionRefs) && flow.selectionRefs.length <= 3 && flow.selectionRefs.every(ref => !!validateWorkRef(ref)) && Number.isSafeInteger(flow.pageCursor) && flow.pageCursor >= 0 && (flow.expectedVersion === null || typeof flow.expectedVersion === 'string' && flow.expectedVersion.length <= 256) && typeof flow.policyRevision === 'string' && !!flow.policyRevision && (flow.sourceReceipt === null || typeof flow.sourceReceipt === 'string' && flow.sourceReceipt.length <= 512) && (!flow.knowledgeReviewIds || Array.isArray(flow.knowledgeReviewIds) && flow.knowledgeReviewIds.length <= 5 && flow.knowledgeReviewIds.every(id => typeof id === 'string' && id.length <= 256));
  } catch {
    return false;
  }
}
/** Pure narrowing only; the application separately verifies principal/token provenance. */
export function validateWorkDecisionReply({
  decision,
  principal,
  tokenHash,
  botMessageId,
  policyRevision,
  asOf
}) {
  if (!decision || !principal?.authored || principal.kind !== 'callback' || principal.username !== decision.username || principal.senderId !== decision.senderId || principal.conversationId !== decision.conversationId || principal.messageId !== String(botMessageId) || decision.botMessageId !== String(botMessageId) || decision.policyRevision !== policyRevision || !Number.isFinite(asOf) || asOf < decision.createdAt || asOf >= decision.expiresAt || !['delivered', 'claimed', 'resolved'].includes(decision.status)) return {
    denied: 'stale_or_unbound_decision'
  };
  const choice = decision.choices.find(row => row.tokenHash === tokenHash);
  return choice ?? {
    denied: 'unknown_choice'
  };
}
