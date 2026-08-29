function responseContent(response) {
  return typeof response === 'string' ? response : response?.content || response?.message || null;
}

export function normalizeAiEffect(eventType, response) {
  const content = responseContent(response);
  if (typeof content !== 'string' || !content.trim() || content.length > 500) return null;
  if (eventType !== 'outcome.proposed') return { type: 'ai.commentary', content: content.trim() };
  try {
    const proposal = JSON.parse(content);
    if (proposal?.advisory !== true || !['confirm', 'reject', 'abstain'].includes(proposal.recommendation) || typeof proposal.reason !== 'string' || !proposal.reason.trim() || proposal.reason.length > 300) return null;
    return { type: 'ai.judgment-proposal', proposal: { advisory: true, recommendation: proposal.recommendation, reason: proposal.reason.trim() } };
  } catch { return null; }
}

export class GamingEffectService {
  constructor({ aiPolicy = null, aiCommentary = true, aiAdvisoryJudgment = true, printPolicy = null, store = null, observability = null, broadcast = null, autoPrint = false, drawingCheckpoints = null }) {
    Object.assign(this, { aiPolicy, aiCommentary, aiAdvisoryJudgment, printPolicy, store, observability, broadcast, autoPrint, drawingCheckpoints });
  }
  async afterCreate({ session, definition }) {
    this.observability?.increment('session.created', { ruleset: session.header.ruleset.id });
    if (this.autoPrint && session.header.launch?.surface_id === 'party-games') {
      await this.printHostPacket({ sessionId: session.header.session_id, session, definition, explicit: false });
    }
  }
  async afterCommit({ sessionId, result, command, viewer }) {
    this.observability?.increment('command.committed', { ruleset: result.header.ruleset.id });
    try { await this.observability?.audit(sessionId, { kind: 'command-decision', actor_id: command.actor_id, viewer_role: viewer?.role || null, command: command.command, revision: result.header.revision }); }
    catch (error) { this.reportFailure('audit', error, { sessionId, revision: result.header.revision }); }
    if ((result.events || []).some((envelope) => ['challenge.finished', 'outcome.committed', 'game.completed', 'session.closed'].includes(envelope.event?.type))) {
      try { await this.drawingCheckpoints?.delete(sessionId); }
      catch (error) { this.reportFailure('drawing-checkpoint-delete', error, { sessionId }); }
    }
    if (!this.aiPolicy) return;
    for (const envelope of result.events || []) {
      if (!['challenge.finished', 'outcome.committed', 'outcome.proposed'].includes(envelope.event?.type)) continue;
      if (envelope.event.type === 'outcome.proposed' && !this.aiAdvisoryJudgment) continue;
      if (envelope.event.type !== 'outcome.proposed' && !this.aiCommentary) continue;
      const response = await this.aiPolicy.propose(`${sessionId}:commentary`, { messages: [
        { role: 'system', content: envelope.event.type === 'outcome.proposed'
          ? 'Return only JSON: {"advisory":true,"recommendation":"confirm|reject|abstain","reason":"short family-friendly reason"}. This never decides the outcome.'
          : 'Give one short, family-friendly game host comment.' },
        { role: 'user', content: JSON.stringify({ event: envelope.event, state: result.state }) },
      ], options: { maxTokens: 80 } });
      const normalized = normalizeAiEffect(envelope.event.type, response);
      if (!normalized) { if (response) this.reportFailure('ai-response-validation', new Error('AI effect response did not match its advisory contract'), { sessionId, eventType: envelope.event.type }); continue; }
      const effect = { ...normalized, causation_id: envelope.event_id, revision: result.header.revision };
      try {
        await this.store?.appendEffect(sessionId, effect);
        this.broadcast?.({ source: 'gaming-effects', topic: 'gaming', kind: 'effect', sessionId, effect, ts: Date.now() });
      } catch (error) { this.reportFailure('effect-persistence', error, { sessionId, eventType: envelope.event.type }); }
    }
  }
  reportFailure(stage, error, fields = {}) {
    this.observability?.increment('effect.failure', { stage });
    this.observability?.operational('gaming.effect.failed', { stage, error: error?.message || String(error), ...fields }, 'warn');
  }
  async printHostPacket({ sessionId, session, definition, explicit = true }) {
    if (!this.printPolicy) return { status: 'printing-unavailable' };
    try {
      const receipt = await this.printPolicy.print({ sessionId, content: { title: `${definition.title || definition.id || 'Party Games'} Host Packet`, session, definition }, explicit, autoPrint: this.autoPrint });
      await this.observability?.audit(sessionId, { kind: 'print-decision', explicit, status: receipt.status, duplicate: Boolean(receipt.duplicate) }); return receipt;
    } catch (error) { this.observability?.operational('gaming.print.failed', { sessionId, error: error.message }); return { status: 'failed', message: 'Host packet printing failed' }; }
  }
  list(sessionId) { return this.store?.listEffects(sessionId) || []; }
}
