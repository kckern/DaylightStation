import test from 'node:test';
import assert from 'node:assert/strict';
import { FitnessSession } from '../FitnessSession.js';
import { DeviceAssignmentLedger } from '../DeviceAssignmentLedger.js';
import { GuestAssignmentService } from '../GuestAssignmentService.js';

const setup = () => {
  const session = new FitnessSession();
  const ledger = new DeviceAssignmentLedger({ eventJournal: session.eventJournal });
  session.userManager.setAssignmentLedger(ledger);
  const service = new GuestAssignmentService({ session, ledger });
  return { session, ledger, service };
};

const teardown = (session) => {
  session?._stopAutosaveTimer?.();
  session?._stopTickTimer?.();
};

test('grace period transfer: moves history and marks user as transferred', async () => {
  const { session, ledger, service } = setup();
  
  // 1. Setup original user "User_5" on device "dev1"
  const sorenId = 'user_5';
  session.userManager.registerUser({ name: 'User_5', hr_device_id: 'dev1', id: sorenId });
  session.deviceManager.registerDevice({ id: 'dev1', type: 'heart_rate' });
  
  // Create a session entity for User_5
  session.ensureStarted({ force: true });
  
  // 2. Mock timeline and treasurebox transfer methods to track calls
  let timelineTransferred = false;
  let treasureBoxTransferred = false;
  
  if (session.timeline) {
    const originalTransfer = session.timeline.transferUserSeries;
    session.timeline.transferUserSeries = (from, to) => {
      timelineTransferred = true;
      assert.equal(from, sorenId);
      assert.equal(to, 'user_6');
    };
  }
  
  if (session.treasureBox) {
    session.treasureBox.transferAccumulator = (from, to) => {
      treasureBoxTransferred = true;
      assert.equal(from, sorenId);
      assert.equal(to, 'user_6');
      return true;
    };
  }

  // 3. Assign guest "User_6" within grace period
  // We need to simulate that "User_5" was recently active
  const now = Date.now();
  ledger.upsert({
    deviceId: 'dev1',
    occupantId: sorenId,
    occupantName: 'User_5',
    updatedAt: now - 30000 // 30 seconds ago (well within 60s grace period)
  });

  // Ensure TrevorBox exists for the service to see it
  if (!session.treasureBox) {
    session.treasureBox = {
      perUser: new Map(),
      transferAccumulator: () => true
    };
  }
  
  // Re-mock transfer if we just created it
  const originalTreasureBoxTransfer = session.treasureBox.transferAccumulator;
  session.treasureBox.transferAccumulator = (from, to) => {
    treasureBoxTransferred = true;
    assert.equal(from, sorenId);
    assert.equal(to, 'user_6');
    return true;
  };

  service.assignGuest('dev1', { name: 'User_6', profileId: 'user_6' });

  // 4. Verifications
  
  // Verify user was marked as transferred
  const transferred = session.getTransferredUsers();
  assert.ok(transferred.has(sorenId), 'Original user should be marked as transferred');
  
  // Verify data transfer methods were called
  assert.ok(timelineTransferred, 'Timeline history should be transferred');
  assert.ok(treasureBoxTransferred, 'TreasureBox accumulator should be transferred');
  
  // Verify metadata of new assignment (no timelineUserId should be present)
  const jinAssignment = ledger.get('dev1');
  assert.equal(jinAssignment.occupantName, 'User_6');
  assert.ok(!jinAssignment.metadata?.timelineUserId, 'timelineUserId should NOT be in metadata');
  
  teardown(session);
});

test('non-grace period assignment: does NOT transfer data', async () => {
  const { session, ledger, service } = setup();
  
  const sorenId = 'user_5';
  session.userManager.registerUser({ name: 'User_5', hr_device_id: 'dev1', id: sorenId });
  
  let timelineTransferred = false;
  if (session.timeline) {
    session.timeline.transferUserSeries = () => { timelineTransferred = true; };
  }

  const now = Date.now();
  ledger.upsert({
    deviceId: 'dev1',
    occupantId: sorenId,
    occupantName: 'User_5',
    updatedAt: now - 120000 // 2 minutes ago (exceeds grace period)
  });

  service.assignGuest('dev1', { name: 'user_6', profileId: 'user_6' });

  const transferred = session.getTransferredUsers();
  assert.ok(!transferred.has(sorenId), 'Original user should NOT be marked as transferred');
  assert.ok(!timelineTransferred, 'Timeline history should NOT be transferred');
  
  teardown(session);
});
