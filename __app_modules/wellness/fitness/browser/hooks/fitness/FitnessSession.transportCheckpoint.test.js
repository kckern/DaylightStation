import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../../../../../../frontend/src/lib/api.mjs', () => ({ DaylightAPI: vi.fn().mockResolvedValue({}) }));
const { FitnessSession } = await import('./FitnessSession.js');
const { FitnessTimeline } = await import('./FitnessTimeline.js');
const { FitnessTreasureBox } = await import('./TreasureBox.js');
const { PersistenceManager } = await import('./PersistenceManager.js');
const { SessionService } = await import('../../../server/application/services/SessionService.mjs');
const { serializeSession, reconstituteSession } = await import('../../../server/application/sessionRecords.mjs');
const { dehydrateSessionRecord } = await import('../../../server/adapters/persistence/YamlSessionDatastore.mjs');

let wall, mono;
function fixture() {
  const session = new FitnessSession();
  session.sessionId = 'fs_20261116120000';
  session.startTime = wall - 600000;
  session.timeline = new FitnessTimeline(session.startTime, 5000);
  session.timeline.tick({ 'user:alex:heart_rate': 120 }, { timestamp: wall });
  session._timelineRecorder.setTimeline(session.timeline);
  session.deviceManager.lastPacketAt = wall;
  session.activeDeviceIds.add('1001');
  Object.defineProperty(session, 'roster', { get: () => [] });
  const persist = vi.spyOn(session, '_persistSession').mockImplementation(() => { session._persistenceManager._successfulSaveRevision = (session._persistenceManager._successfulSaveRevision || 0) + 1; return true; });
  return { session, persist };
}
function lose(session) {
  session.setTransportState({ state: 'lost', at: wall, incidentId: 'incident-1', silenceMs: 60000 });
  // Same order as the real watchdog: onState, then the durable incident event.
  session.logEvent('fitness_transport', { type: 'lost', incidentId: 'incident-1' });
  mono += 120000; wall += 120000;
  session.setTransportState({ state: 'lost', at: wall, incidentId: 'incident-1', silenceMs: 180000 });
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('transport checkpoints', () => {
  beforeEach(() => {
    wall = Date.parse('2026-11-16T20:00:00Z'); mono = 10000;
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
  });
  afterEach(() => vi.restoreAllMocks());

  it('global outage past 180000 ms checkpoints instead of empty-roster ending', async () => {
    const { session, persist } = fixture();
    const endSession = vi.spyOn(session, 'endSession');
    lose(session);
    session._checkEmptyRosterTimeout();
    await settle();
    const checkpoint = persist.mock.calls.at(-1)[0];
    expect(checkpoint.transportPause).not.toBeNull();
    expect(checkpoint.events.some(e => e.type === 'fitness_transport' && e.data.type === 'lost')).toBe(true);
    expect(endSession).not.toHaveBeenCalledWith('empty_roster');
  });

  it('fresh packets resume the same eligible session without credit through the gap', async () => {
    const { session } = fixture();
    session.treasureBox = new FitnessTreasureBox(session);
    session.treasureBox.configure({ zones: [{ id: 'active', min: 100, color: 'green', rings: 1 }] });
    session.treasureBox.recordUserHeartRate('alex', 120);
    expect(session.treasureBox.perUser.get('alex').highestZone).not.toBeNull();
    const before = session.summary;
    const record = vi.spyOn(session._timelineRecorder, 'recordTick');
    lose(session);
    session._collectTimelineTick({ timestamp: wall });
    session._maybeTickTimeline();
    expect(record).not.toHaveBeenCalled();
    const earnedBefore = session.treasureBox.totalRings;
    mono += 10000; wall += 10000;
    session.deviceManager.lastPacketAt = wall;
    session.setTransportState({ state: 'healthy', reason: 'sample-delivered', at: wall });
    session.treasureBox.recordUserHeartRate('alex', 120);
    const after = session.summary;
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.transportPause).toBeNull();
    expect((session.treasureBox.totalRings) - earnedBefore).toBe(0);
    expect(session.timeline.series['user:alex:heart_rate'].slice(1).filter(v => v !== null)).toHaveLength(0);
    expect(after.transportGaps[0].endedAt).toBe(wall);
    expect(session.timeline.timebase.lastTickTimestamp).toBe(wall);
  });

  it('manual end, Stop or expired resume window prevents automatic resume', () => {
    for (const reason of ['manual', 'force_break']) {
      const { session } = fixture();
      lose(session);
      session.activeDeviceIds.clear(); // devices may already have been pruned
      session.endSession(reason);
      session.ingestData({ deviceId: '1001', type: 'heart_rate', heartRate: 120 });
      expect(session.deviceManager.getAllDevices()).toHaveLength(0);
      session.setTransportState({ state: 'healthy', reason: 'sample-delivered', at: wall });
      expect(session.sessionId).toBeNull();
    }
    const { session, persist } = fixture();
    lose(session);
    // Wall-clock changes cannot prolong an elapsed resume deadline.
    mono += 30 * 60 * 1000; wall -= 3600000;
    session.setTransportState({ state: 'healthy', reason: 'sample-delivered', at: wall });
    expect(session.sessionId).toBeNull();
    expect(persist.mock.calls.at(-1)[0].endReason).toBe('transport_lost');
    expect(persist.mock.calls.at(-1)[0].finalized).toBe(true);
  });

  it('preserves checkpoint metadata through browser encoding, server normalization, YAML and reopening', async () => {
    const { session, persist } = fixture();
    lose(session); await settle();
    const checkpoint = persist.mock.calls.at(-1)[0];
    // Real browser writer with a fake HTTP/store boundary; all serializers are real.
    let saved;
    const service = new SessionService({ defaultHouseholdId: 'test', sessionStore: {
      findById: async () => null,
      save: async entity => { saved = JSON.parse(JSON.stringify(dehydrateSessionRecord(entity))); },
    } });
    const pm = new PersistenceManager({ persistApi: async (url, body) => {
      if (url.endsWith('save_session')) return service.saveSession(body.sessionData);
      return { granted: true };
    } });
    const input = { ...checkpoint, roster: [{ userId: 'alex' }], timeline: {
      ...checkpoint.timeline, series: { 'user:alex:hr': Array(120).fill(120) },
      timebase: { ...checkpoint.timeline.timebase, tickCount: 120 },
    } };
    expect(pm.persistSession(input, { force: true })).toBe(true);
    await pm.whenLastSaveSettled();
    expect(pm.successfulSaveRevision).toBe(1);
    const reopened = serializeSession(reconstituteSession(saved));
    expect(reopened.metadata.transportPause).toEqual(checkpoint.transportPause);
    expect(reopened.metadata.transportGaps).toEqual(checkpoint.transportGaps);
    const restored = new FitnessSession();
    restored._hydrateFromSession(reopened);
    expect(restored.summary.transportPause).toEqual(checkpoint.transportPause);
    const hydratedTicks = restored.timeline.timebase.tickCount;
    restored.setTransportState({ state: 'healthy', reason: 'sample-delivered', at: wall });
    expect(restored.timeline.timebase.tickCount).toBe(hydratedTicks);
    input.metadata = { ...input.metadata, endReason: 'transport_lost' };
    input.finalized = true;
    expect(pm.persistSession(input, { force: true })).toBe(true);
    await pm.whenLastSaveSettled();
    expect(serializeSession(reconstituteSession(saved))).toMatchObject({ finalized: true, metadata: { endReason: 'transport_lost' } });
  });

  it('keeps autosave available after a rejected checkpoint and retries without claiming durability', async () => {
    const { session, persist } = fixture();
    persist.mockImplementation(() => true); // accepted locally, never committed
    const stop = vi.spyOn(session, '_stopAutosaveTimer');
    lose(session); await settle();
    expect(stop).not.toHaveBeenCalled();
    session._maybeAutosave(); await settle();
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('waits for the checkpoint including the lost event before suspending autosave', async () => {
    const { session } = fixture();
    let complete;
    vi.spyOn(session, 'whenFinalPersistSettled').mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const stop = vi.spyOn(session, '_stopAutosaveTimer');
    lose(session);
    expect(stop).not.toHaveBeenCalled();
    complete(); await settle();
    expect(stop).toHaveBeenCalled();
  });
});
