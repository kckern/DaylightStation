import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceEngine } from '../GovernanceEngine.js';
import overlapFixture from './GovernanceRequirements.overlap.fixture.json' assert { type: 'json' };

const zoneRankMap = { green: 0, yellow: 1, red: 2 };

const buildEngine = () => {
  const engine = new GovernanceEngine();
  engine._latestInputs.zoneRankMap = zoneRankMap;
  engine.phase = 'red';
  return engine;
};

test('state.lockRows collapses stricter overlapping requirements for the same participant', () => {
  const engine = buildEngine();
  engine.requirementSummary = {
    policyId: 'p1',
    targetUserCount: null,
    requirements: [
      { zone: 'green', zoneLabel: 'Green', missingUsers: ['blue'], satisfied: false },
      { zone: 'yellow', zoneLabel: 'Yellow', missingUsers: ['blue'], satisfied: false }
    ],
    activeCount: 1
  };

  const state = engine.state;

  assert.ok(Array.isArray(state.lockRows), 'lockRows should exist');
  assert.equal(state.lockRows.length, 1, 'duplicate participant rows should collapse');
  assert.equal(state.lockRows[0].zone, 'yellow');
  assert.deepEqual(state.lockRows[0].missingUsers, ['blue']);
  assert.equal(state.lockRows[0].targetZoneId, 'yellow');
  assert.equal(state.lockRows[0].severity, zoneRankMap.yellow);
});

test('fixture overlap collapses to strictest requirement', () => {
  const engine = buildEngine();
  engine.requirementSummary = {
    policyId: 'p1',
    targetUserCount: null,
    requirements: overlapFixture,
    activeCount: 1
  };

  const state = engine.state;

  assert.equal(state.lockRows.length, 1);
  assert.equal(state.lockRows[0].zone, 'yellow');
  assert.deepEqual(state.lockRows[0].missingUsers, ['blue']);
});

test('lockRows combines pending challenge requirement with baseline and keeps strictest per participant', () => {
  const engine = buildEngine();
  engine.requirementSummary = {
    policyId: 'p1',
    targetUserCount: null,
    requirements: [
      { zone: 'green', zoneLabel: 'Green', missingUsers: ['blue'], satisfied: false }
    ],
    activeCount: 1
  };
  engine.challengeState.activeChallenge = {
    id: 'c1',
    status: 'pending',
    zone: 'yellow',
    requiredCount: 1,
    summary: {
      missingUsers: ['blue'],
      metUsers: [],
      actualCount: 0,
      zoneLabel: 'Yellow'
    }
  };

  const state = engine.state;

  assert.equal(state.lockRows.length, 1, 'challenge + baseline should dedupe to one row');
  assert.equal(state.lockRows[0].zone, 'yellow');
  assert.equal(state.lockRows[0].targetZoneId, 'yellow');
  assert.equal(state.lockRows[0].severity, zoneRankMap.yellow);
});
