import test from 'node:test';
import assert from 'node:assert/strict';
import { FitnessSession } from '../FitnessSession.js';
import { DeviceAssignmentLedger } from '../DeviceAssignmentLedger.js';

const setupSession = () => {
  const session = new FitnessSession();
  const ledger = new DeviceAssignmentLedger({ eventJournal: session.eventJournal });
  session.userManager.setAssignmentLedger(ledger);
  return { session, ledger };
};

const teardownSession = (session) => {
  session?._stopAutosaveTimer?.();
  session?._stopTickTimer?.();
};

test('cleanupOrphanGuests removes stale ledger entries and logs warnings', () => {
  const { session, ledger } = setupSession();
  ledger.upsert({ deviceId: 'dev1', occupantSlug: 'ghost', occupantName: 'Ghost' });
  const result = session.cleanupOrphanGuests();
  assert.equal(result.removed, 1);
  const events = session.eventJournal.getEntries({ type: 'ORPHAN_GUEST_REMOVED' });
  assert.equal(events.length, 1);
  teardownSession(session);
});

test('reconcileAssignments detects mismatched devices', () => {
  const { session, ledger } = setupSession();
  session.userManager.registerUser({ name: 'Alex', hr_device_id: 'dev2', globalZones: [] });
  ledger.upsert({
    deviceId: 'dev1',
    occupantSlug: 'alex',
    occupantName: 'Alex'
  });
  session.deviceManager.registerDevice({ id: 'dev1', type: 'heart_rate' });
  const { mismatches } = session.reconcileAssignments();
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].type, 'device-mismatch');
  const warnings = session.eventJournal.getEntries({ type: 'LEDGER_RECONCILE_WARN' });
  assert.ok(warnings.length >= 1);
  teardownSession(session);
});

test('recordDeviceActivity logs mismatches between ledger and resolved users', () => {
  const { session, ledger } = setupSession();
  session.userManager.registerUser({ name: 'Alex', hr_device_id: 'dev3', globalZones: [] });
  ledger.upsert({
    deviceId: 'dev3',
    occupantSlug: 'guest-one',
    occupantName: 'Guest One'
  });
  session.recordDeviceActivity({ id: 'dev3', deviceId: 'dev3', type: 'heart_rate', heartRate: 140 });
  const entries = session.eventJournal.getEntries({ type: 'LEDGER_DEVICE_MISMATCH' });
  assert.equal(entries.length, 1);
  teardownSession(session);
});
