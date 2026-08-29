/** Coordinates transcription, ended-session persistence, and provider enrichment. */
export class FitnessVoiceMemoService {
  constructor({ transcription, sessions = null, config = null, enrichment = null,
    clock = { now: () => Date.now() }, logger = console } = {}) {
    this.transcription = transcription;
    this.sessions = sessions;
    this.config = config;
    this.enrichment = enrichment;
    this.clock = clock;
    this.logger = logger;
  }

  get available() { return Boolean(this.transcription); }

  async transcribe(input, defaultHouseholdId = null) {
    const { sessionId, context: sessionContext = {} } = input;
    const householdId = sessionContext.householdId || defaultHouseholdId;
    const householdMembers = this.config?.getHouseholdMemberNames(householdId) || [];
    const memo = await this.transcription.transcribeVoiceMemo({
      ...input,
      context: { ...sessionContext, householdMembers },
    });
    const meaningful = sessionId && memo?.transcriptClean && memo.transcriptClean !== '[No Memo]';

    if (meaningful && this.sessions?.appendVoiceMemo) {
      try {
        const existing = await this.sessions.getSession(sessionId, householdId, { decodeTimeline: false });
        const endMs = existing?.endTime || (existing?.session?.end ? Date.parse(existing.session.end) : null);
        if (Boolean(endMs) && endMs < this.clock.now()) {
          const appended = await this.sessions.appendVoiceMemo(sessionId, householdId, {
            transcriptClean: memo.transcriptClean,
            transcriptRaw: memo.transcriptRaw,
            durationSeconds: memo.durationSeconds,
            createdAt: memo.createdAt,
            memoId: memo.memoId,
          });
          this.logger.info?.('fitness.voice_memo.retroactive_persisted', { sessionId, householdId, success: Boolean(appended) });
          if (!appended) {
            this.logger.error?.('fitness.voice_memo.retroactive_persist_dropped', { sessionId, householdId });
            return { kind: 'persist_failed', memo };
          }
        }
      } catch (error) {
        this.logger.warn?.('fitness.voice_memo.retroactive_persist_failed', { sessionId, error: error?.message });
        return { kind: 'persist_failed', memo };
      }
    }

    if (meaningful && this.enrichment) {
      this.enrichment.reEnrichDescription(sessionId, memo).catch((error) => {
        this.logger.warn?.('strava.voice_memo_backfill.failed', { sessionId, error: error?.message });
      });
    }
    return { kind: 'transcribed', memo };
  }
}

export default FitnessVoiceMemoService;
