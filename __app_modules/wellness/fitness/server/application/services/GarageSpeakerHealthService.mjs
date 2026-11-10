import { normalizeGarageSpeakerReport } from '../../domain/services/garageSpeakerHealth.mjs';
import { composeGarageSpeakerGaveUpPush } from '../../domain/notifications/garageSpeakerPush.mjs';

/**
 * Records Home Assistant's garage speaker recovery steps in the structured log
 * as `fitness.garage_speaker.<event>`, attached to the live fitness session
 * when one is running, and pushes the phone when recovery gives up. The logger
 * is expected to carry `{ app: 'fitness', module: 'garage-speaker' }` (set at
 * composition). `sendPush({ title, message, data })` is optional.
 */
export class GarageSpeakerHealthService {
  constructor({ logger, liveSessionAuthority = null, sendPush = null } = {}) {
    this.logger = logger;
    this.liveSessionAuthority = liveSessionAuthority;
    this.sendPush = sendPush;
  }

  record(raw, householdId = null) {
    const report = normalizeGarageSpeakerReport(raw);
    if (!report.ok) {
      this.logger?.warn?.('fitness.garage_speaker.report_rejected', { reason: report.reason, event: raw?.event ?? null });
      return report;
    }
    const sessionId = this.liveSessionAuthority?.current?.(householdId) ?? null;
    const event = `fitness.garage_speaker.${report.event}`;
    this.logger?.[report.level]?.(event, { ...report.data, sessionId });
    if (report.event === 'gave_up') this.#pushGaveUp(report.data);
    return { ok: true, event, sessionId };
  }

  // Fire-and-forget: HA must get its 202 whether or not the phone push lands.
  #pushGaveUp(data) {
    if (!this.sendPush) {
      this.logger?.warn?.('fitness.garage_speaker.push_unavailable', { reason: data.reason });
      return;
    }
    Promise.resolve()
      .then(() => this.sendPush(composeGarageSpeakerGaveUpPush(data)))
      .catch((error) => this.logger?.warn?.('fitness.garage_speaker.push_failed', { error: error?.message ?? String(error) }));
  }
}
