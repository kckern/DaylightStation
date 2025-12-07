import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSeverity, normalizeRequirements } from '../GovernanceEngine.js';

const zoneRankMap = { green: 0, yellow: 1, red: 2 };
const comparator = (a, b) => compareSeverity(a, b, { zoneRankMap });

const findByZone = (normalized, zoneId) => normalized.find((entry) => {
  const zone = entry?.zone || entry?.zoneLabel;
  return zone && String(zone).toLowerCase().includes(zoneId);
});

test('collapses overlapping requirements to the strictest zone for a participant', () => {
  const raw = [
    { zone: 'green', zoneLabel: 'Green', missingUsers: ['blue'], requiredCount: 1 },
    { zone: 'yellow', zoneLabel: 'Yellow', missingUsers: ['blue'], requiredCount: 1 }
  ];

  const normalized = normalizeRequirements(raw, comparator, { zoneRankMap });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].zone, 'yellow');
  assert.deepEqual(normalized[0].missingUsers, ['blue']);
});

test('keeps strictest per participant while allowing different winners per participant', () => {
  const raw = [
    { zone: 'green', missingUsers: ['alice', 'bob'] },
    { zone: 'yellow', missingUsers: ['alice'] }
  ];

  const normalized = normalizeRequirements(raw, comparator, { zoneRankMap });

  const yellow = findByZone(normalized, 'yellow');
  const green = findByZone(normalized, 'green');

  assert.ok(yellow, 'yellow requirement missing');
  assert.ok(green, 'green requirement missing');
  assert.deepEqual(yellow.missingUsers.sort(), ['alice']);
  assert.deepEqual(green.missingUsers.sort(), ['bob']);
});

test('ties favor newer updatedAt then later index', () => {
  const raw = [
    { zone: 'yellow', missingUsers: ['blue'], updatedAt: 1000, ruleLabel: 'older' },
    { zone: 'yellow', missingUsers: ['blue'], updatedAt: 2000, ruleLabel: 'newer' },
    { zone: 'yellow', missingUsers: ['blue'], ruleLabel: 'latest-index' }
  ];

  const normalized = normalizeRequirements(raw, comparator, { zoneRankMap });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].ruleLabel, 'newer');
});

test('groups winners so multiple participants can share the same strict requirement', () => {
  const raw = [
    { zone: 'yellow', missingUsers: ['alice'] },
    { zone: 'yellow', missingUsers: ['bob'] },
    { zone: 'green', missingUsers: ['charlie'] }
  ];

  const normalized = normalizeRequirements(raw, comparator, { zoneRankMap });

  const yellow = findByZone(normalized, 'yellow');
  const green = findByZone(normalized, 'green');

  assert.ok(yellow, 'yellow requirement missing');
  assert.ok(green, 'green requirement missing');
  assert.deepEqual(yellow.missingUsers.sort(), ['alice', 'bob']);
  assert.deepEqual(green.missingUsers.sort(), ['charlie']);
});
