import { describe, it, expect } from 'vitest';
import { CeremonyScheduler } from '#apps/lifeplan/services/CeremonyScheduler.mjs';

describe('CeremonyScheduler sets a dedupeKey on nudges', () => {
  it('includes ceremony:<type>:<periodId> in the sent intent', async () => {
    const sent = [];
    const notificationService = { send: async (i) => { sent.push(i); return [{ delivered: true }]; } };
    // Minimal stubs: a plan with a default-enabled ceremony that is due now, one period, no prior record.
    const plan = { ceremonies: {}, cadence: {} };
    const lifePlanStore = { load: () => plan };
    const ceremonyRecordStore = { hasRecord: () => false, getLatestRecord: () => null };
    const cadenceService = { isCeremonyDue: (timing) => timing === 'start_of_unit', resolve: () => ({ unit: { periodId: '2026-07-17' } }) };
    const scheduler = new CeremonyScheduler({
      notificationService, lifePlanStore, ceremonyRecordStore, cadenceService,
      timezone: 'America/Los_Angeles',
      clock: { now: () => new Date(2026, 6, 17, 7, 0, 0), today: () => '2026-07-17' },
      logger: { info() {}, debug() {}, warn() {} },
    });
    // The public entry that sends nudges — confirmed real name by reading the file (checkAndNotify(username)).
    await scheduler.checkAndNotify('kckern');
    const unitIntention = sent.find(i => i.metadata?.ceremony === 'unit_intention' || (i.dedupeKey || '').includes('unit_intention'));
    expect(unitIntention).toBeTruthy();
    expect(unitIntention.dedupeKey).toBe('ceremony:unit_intention:2026-07-17');
  });
});
