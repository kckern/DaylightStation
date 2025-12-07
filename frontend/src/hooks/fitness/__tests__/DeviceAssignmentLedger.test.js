import test from 'node:test';
import assert from 'node:assert/strict';
import { UserManager } from '../UserManager.js';
import { DeviceAssignmentLedger } from '../DeviceAssignmentLedger.js';
import { EventJournal } from '../EventJournal.js';

const setupManager = () => {
  const manager = new UserManager();
  const ledger = new DeviceAssignmentLedger();
  const changes = { count: 0 };
  manager.setAssignmentLedger(ledger, {
    onChange: () => {
      changes.count += 1;
    }
  });
  // Reset to ignore hydration change notification
  changes.count = 0;
  return { manager, ledger, changes };
};

test('assignGuest populates ledger entries with displaced slug metadata', () => {
  const { manager, ledger, changes } = setupManager();
  manager.assignGuest('42', 'Charlie', {
    baseUserName: 'Alice',
    zones: [{ id: 'warm', min: 120 }]
  });
  const entry = ledger.get('42');
  assert.ok(entry, 'ledger entry missing');
  assert.equal(entry.occupantName, 'Charlie');
  assert.equal(entry.displacedSlug, 'alice');
  assert.equal(entry.occupantType, 'guest');
  assert.equal(changes.count, 1, 'ledger change should fire once for assignment');
});

test('reassigning guest updates ledger occupant', () => {
  const { manager, ledger, changes } = setupManager();
  manager.assignGuest('42', 'Charlie', { baseUserName: 'Alice' });
  manager.assignGuest('42', 'Dana', { baseUserName: 'Bob' });
  const entry = ledger.get('42');
  assert.equal(entry.occupantName, 'Dana');
  assert.equal(entry.displacedSlug, 'bob');
  assert.equal(changes.count, 2, 'ledger should record both assignments');
});

test('clearing guest removes ledger entry', () => {
  const { manager, ledger, changes } = setupManager();
  manager.assignGuest('42', 'Charlie', { baseUserName: 'Alice' });
  manager.assignGuest('42', null);
  assert.equal(ledger.get('42'), null);
  assert.equal(changes.count, 2, 'ledger should notify on assign and clear');
});

test('ledger emits journal events when entries mutate', () => {
  const journal = new EventJournal();
  const ledger = new DeviceAssignmentLedger({ eventJournal: journal });
  ledger.upsert({ deviceId: 'dev-1', occupantSlug: 'sam', occupantName: 'Sam' });
  ledger.remove('dev-1');
  const types = journal.getEntries().map((entry) => entry.type);
  assert.deepEqual(types, ['LEDGER_UPSERT', 'LEDGER_REMOVE']);
});