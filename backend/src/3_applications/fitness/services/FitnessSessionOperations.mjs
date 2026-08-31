/** Cohesive session queries/workflows used by the HTTP surface. */
export class FitnessSessionOperations {
  constructor({
    sessions, grouping = null, timelapse = null, renderReceipt = null,
    config = null, onSessionsChanged = null, logger = console,
  }) {
    this.sessions = sessions;
    this.grouping = grouping;
    this.timelapse = timelapse;
    this.renderReceipt = renderReceipt;
    this.config = config;
    this.onSessionsChanged = onSessionsChanged;
    this.logger = logger;
  }

  notifySessionsChanged(change) {
    if (typeof this.onSessionsChanged !== 'function') return;
    try {
      Promise.resolve(this.onSessionsChanged(change)).catch((error) => {
        this.logger.warn?.('fitness.sessions.state-gates-refresh-failed', { error: error?.message });
      });
    } catch (error) {
      this.logger.warn?.('fitness.sessions.state-gates-refresh-failed', { error: error?.message });
    }
  }

  async dates(householdId) {
    return { dates: await this.sessions.listDates(householdId), household: this.sessions.resolveHouseholdId(householdId) };
  }

  async detail(sessionId, householdId) {
    if (sessionId.startsWith('group:') && this.grouping) {
      const session = await this.grouping.getGroupDetail(sessionId, householdId);
      return session ? { kind: 'group', session } : { kind: 'not_found' };
    }
    const session = await this.sessions.getSession(sessionId, householdId, { decodeTimeline: true });
    if (!session) return { kind: 'not_found' };
    let activities = null;
    if (this.grouping) {
      try { activities = await this.grouping.enrichSession(sessionId, householdId); }
      catch (error) { this.logger.warn?.('fitness.sessions.detail.enrich.error', { sessionId, error: error?.message }); }
    }
    return { kind: 'found', session, activities };
  }

  async delete(sessionId, householdId) {
    if (!await this.sessions.getSession(sessionId, householdId)) return { kind: 'not_found' };
    await this.sessions.deleteSession(sessionId, householdId);
    this.notifySessionsChanged({ operation: 'deleted', sessionId, householdId });
    this.logger.info?.('fitness.sessions.deleted', { sessionId });
    return { kind: 'deleted' };
  }

  async end(sessionId, householdId, endTime) {
    const session = await this.sessions.endSession(sessionId, householdId, endTime);
    this.notifySessionsChanged({ operation: 'ended', sessionId, householdId });
    this.logger.info?.('fitness.sessions.finalized', { sessionId, endTime, durationMs: session.durationMs });
    if (this.timelapse) Promise.resolve(this.timelapse.execute({
      sessionId: session.sessionId?.toString() || sessionId, householdId,
    })).then((result) => this.logger.info?.('fitness.timelapse.trigger_done', { sessionId, status: result?.status }))
      .catch((error) => this.logger.error?.('fitness.timelapse.trigger_failed', { sessionId, error: error?.message }));
    return session;
  }

  get receiptAvailable() { return Boolean(this.renderReceipt); }
  async receipt(sessionId, upsidedown) {
    if (!this.renderReceipt) return { kind: 'unconfigured' };
    const result = await this.renderReceipt(sessionId, upsidedown);
    return result ? { kind: 'rendered', bytes: result.canvas.toBuffer('image/png') } : { kind: 'not_found' };
  }

  async save({ sessionData, householdId, userAgent }) {
    if (this.config && !this.config.mayWriteSession(householdId, userAgent)) {
      this.logger.warn?.('fitness.sessions.save.blocked', {
        reason: 'client not in session_write_whitelist', userAgent, sessionId: sessionData?.sessionId,
      });
      return { kind: 'forbidden' };
    }
    const value = await this.sessions.saveSessionWithReceipt(sessionData, householdId);
    this.notifySessionsChanged({ operation: 'saved', sessionId: sessionData?.sessionId ?? null, householdId });
    return { kind: 'saved', ...value };
  }
}

export default FitnessSessionOperations;
