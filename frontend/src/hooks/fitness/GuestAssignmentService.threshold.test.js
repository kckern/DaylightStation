// W1.A — GuestAssignmentService configurable continuous-usage threshold.
//
// Per audit Decision §7: the hardcoded 60-second grace period is replaced
// with a constructor-injected `thresholdMs` (sourced from
// fitness.yml → governance.usage_threshold_seconds at the React/Context layer).
//
// CRITICAL: the constructor default stays at 60_000 ms for back-compat with
// the existing GuestAssignmentService unit tests (which assume a 60s window).
// The 300-second default lives at the FitnessConfigService layer, not here.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GuestAssignmentService } from './GuestAssignmentService.js';

describe('GuestAssignmentService — configurable threshold', () => {
  it('uses constructor-provided thresholdMs', () => {
    const service = new GuestAssignmentService({ thresholdMs: 5 * 60 * 1000 });
    expect(service.thresholdMs).toBe(300000);
  });

  it('defaults thresholdMs to 60000 when not provided (back-compat for existing tests)', () => {
    const service = new GuestAssignmentService({});
    expect(service.thresholdMs).toBe(60000);
  });

  it('defaults thresholdMs to 60000 when constructed with no arguments', () => {
    const service = new GuestAssignmentService();
    expect(service.thresholdMs).toBe(60000);
  });

  it('rejects non-finite thresholdMs and falls back to default', () => {
    const service = new GuestAssignmentService({ thresholdMs: NaN });
    expect(service.thresholdMs).toBe(60000);
  });
});

describe('GuestAssignmentService — threshold drives grace-period transfer boundary', () => {
  // These tests exercise the actual assignGuest path with a real (mocked)
  // ledger/session and assert that the configured `thresholdMs` — not the
  // (deleted) module-level GRACE_PERIOD_MS — controls the transfer/drop split.

  let mockUserManager;
  let mockSession;
  let mockEventJournal;

  beforeEach(() => {
    mockEventJournal = { log: vi.fn() };
    mockUserManager = { assignGuest: vi.fn() };
    mockSession = {
      userManager: mockUserManager,
      createSessionEntity: vi.fn().mockReturnValue({ entityId: 'entity-new' }),
      endSessionEntity: vi.fn(),
      transferSessionEntity: vi.fn().mockReturnValue({ ok: true }),
      transferUserSeries: vi.fn().mockReturnValue({ ok: true }),
      entityRegistry: { get: vi.fn() },
      eventJournal: mockEventJournal
    };
  });

  function buildLedgerWithPrevious({ ageMs, occupantId = 'alice-1', entityId = 'entity-prev' }) {
    return {
      get: vi.fn().mockReturnValue({
        deviceId: 'device-1',
        metadata: { profileId: occupantId },
        occupantId,
        entityId,
        updatedAt: Date.now() - ageMs
      }),
      entries: new Map()
    };
  }

  it('emits SEGMENT_ABSORBED when previous segment age < thresholdMs (default 60s)', () => {
    const ledger = buildLedgerWithPrevious({ ageMs: 30 * 1000 }); // 30s ago
    const service = new GuestAssignmentService({ session: mockSession, ledger });

    const result = service.assignGuest('device-1', {
      name: 'Bob',
      profileId: 'bob-2'
    });

    expect(result.ok).toBe(true);
    const loggedTypes = mockEventJournal.log.mock.calls.map((call) => call[0]);
    expect(loggedTypes).toContain('SEGMENT_ABSORBED');
    expect(loggedTypes).not.toContain('GUEST_REPLACED');
  });

  it('emits GUEST_REPLACED (drop) when age >= thresholdMs (default 60s)', () => {
    const ledger = buildLedgerWithPrevious({ ageMs: 90 * 1000 }); // 90s ago
    const service = new GuestAssignmentService({ session: mockSession, ledger });

    const result = service.assignGuest('device-1', {
      name: 'Bob',
      profileId: 'bob-2'
    });

    expect(result.ok).toBe(true);
    const loggedTypes = mockEventJournal.log.mock.calls.map((call) => call[0]);
    expect(loggedTypes).toContain('GUEST_REPLACED');
    expect(loggedTypes).not.toContain('SEGMENT_ABSORBED');
  });

  it('honours a custom larger thresholdMs: 90s-old segment still absorbs when threshold=300s', () => {
    const ledger = buildLedgerWithPrevious({ ageMs: 90 * 1000 }); // 90s ago
    const service = new GuestAssignmentService({
      session: mockSession,
      ledger,
      thresholdMs: 300 * 1000 // 5 min
    });

    const result = service.assignGuest('device-1', {
      name: 'Bob',
      profileId: 'bob-2'
    });

    expect(result.ok).toBe(true);
    const loggedTypes = mockEventJournal.log.mock.calls.map((call) => call[0]);
    expect(loggedTypes).toContain('SEGMENT_ABSORBED');
    expect(loggedTypes).not.toContain('GUEST_REPLACED');
  });

  it('honours a custom smaller thresholdMs: 20s-old segment drops when threshold=10s', () => {
    const ledger = buildLedgerWithPrevious({ ageMs: 20 * 1000 }); // 20s ago
    const service = new GuestAssignmentService({
      session: mockSession,
      ledger,
      thresholdMs: 10 * 1000 // 10s
    });

    const result = service.assignGuest('device-1', {
      name: 'Bob',
      profileId: 'bob-2'
    });

    expect(result.ok).toBe(true);
    const loggedTypes = mockEventJournal.log.mock.calls.map((call) => call[0]);
    expect(loggedTypes).toContain('GUEST_REPLACED');
    expect(loggedTypes).not.toContain('SEGMENT_ABSORBED');
  });

  it('records thresholdMs in the SEGMENT_ABSORBED event payload (W1.C)', () => {
    const ledger = buildLedgerWithPrevious({ ageMs: 30 * 1000 });
    const service = new GuestAssignmentService({
      session: mockSession,
      ledger,
      thresholdMs: 120 * 1000 // 2 min
    });

    service.assignGuest('device-1', { name: 'Bob', profileId: 'bob-2' });

    const absorbedCall = mockEventJournal.log.mock.calls.find(c => c[0] === 'SEGMENT_ABSORBED');
    expect(absorbedCall).toBeTruthy();
    expect(absorbedCall[1].thresholdMs).toBe(120 * 1000);
  });

  it('records thresholdMs in the GUEST_REPLACED event payload (W1.C)', () => {
    const ledger = buildLedgerWithPrevious({ ageMs: 90 * 1000 });
    const service = new GuestAssignmentService({
      session: mockSession,
      ledger,
      thresholdMs: 60 * 1000
    });

    service.assignGuest('device-1', { name: 'Bob', profileId: 'bob-2' });

    const replacedCall = mockEventJournal.log.mock.calls.find(c => c[0] === 'GUEST_REPLACED');
    expect(replacedCall).toBeTruthy();
    expect(replacedCall[1].thresholdMs).toBe(60 * 1000);
  });
});
