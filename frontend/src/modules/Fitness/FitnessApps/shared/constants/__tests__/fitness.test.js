/**
 * Unit tests for shared/constants/fitness.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ZONE_IDS,
  ZONES,
  ZONE_COLORS,
  getZoneColor,
  getZoneByPercent,
  getZoneByBpm,
  GOVERNANCE_STATUS,
  GOVERNANCE_PRIORITY,
  compareGovernanceStatus,
  TIMING,
  TREASURE_COIN_COLORS,
  getCoinColorRank,
  SIDEBAR_SIZE_MODE,
  PLAYER_MODE
} from '../fitness.js';

// =============================================================================
// Zone constants tests
// =============================================================================

test('ZONE_IDS contains all zone identifiers in order', () => {
  assert.deepEqual(ZONE_IDS, ['rest', 'cool', 'active', 'warm', 'hot', 'fire']);
});

test('ZONES contains complete definitions for each zone', () => {
  assert.ok(ZONES.rest, 'rest zone should exist');
  assert.ok(ZONES.fire, 'fire zone should exist');
  
  // Check structure of a zone
  const zone = ZONES.warm;
  assert.equal(zone.id, 'warm');
  assert.equal(zone.name, 'Warm');
  assert.equal(typeof zone.minPercent, 'number');
  assert.equal(typeof zone.maxPercent, 'number');
  assert.equal(typeof zone.intensity, 'number');
  assert.equal(typeof zone.hex, 'string');
  assert.ok(zone.hex.startsWith('#'));
});

test('ZONE_COLORS provides hex values for zone IDs and color aliases', () => {
  assert.equal(ZONE_COLORS.rest, '#888888');
  assert.equal(ZONE_COLORS.gray, '#888888');
  assert.equal(ZONE_COLORS.fire, '#ff6b6b');
  assert.equal(ZONE_COLORS.red, '#ff6b6b');
  assert.equal(ZONE_COLORS.cool, '#6ab8ff');
  assert.equal(ZONE_COLORS.blue, '#6ab8ff');
});

// =============================================================================
// getZoneColor tests
// =============================================================================

test('getZoneColor: returns correct color for zone IDs', () => {
  assert.equal(getZoneColor('rest'), '#888888');
  assert.equal(getZoneColor('fire'), '#ff6b6b');
  assert.equal(getZoneColor('warm'), '#ffd43b');
});

test('getZoneColor: returns correct color for color aliases', () => {
  assert.equal(getZoneColor('red'), '#ff6b6b');
  assert.equal(getZoneColor('green'), '#51cf66');
  assert.equal(getZoneColor('blue'), '#6ab8ff');
});

test('getZoneColor: is case-insensitive', () => {
  assert.equal(getZoneColor('RED'), '#ff6b6b');
  assert.equal(getZoneColor('Fire'), '#ff6b6b');
});

test('getZoneColor: returns fallback for unknown values', () => {
  assert.equal(getZoneColor('unknown'), '#888888');
  assert.equal(getZoneColor(null), '#888888');
  assert.equal(getZoneColor('purple', '#abc123'), '#abc123');
});

// =============================================================================
// getZoneByPercent tests
// =============================================================================

test('getZoneByPercent: returns correct zone for HR percentages', () => {
  assert.equal(getZoneByPercent(0).id, 'rest');
  assert.equal(getZoneByPercent(45).id, 'rest');
  assert.equal(getZoneByPercent(55).id, 'cool');
  assert.equal(getZoneByPercent(65).id, 'active');
  assert.equal(getZoneByPercent(75).id, 'warm');
  assert.equal(getZoneByPercent(85).id, 'hot');
  assert.equal(getZoneByPercent(95).id, 'fire');
});

test('getZoneByPercent: handles boundary cases', () => {
  assert.equal(getZoneByPercent(50).id, 'cool');
  assert.equal(getZoneByPercent(60).id, 'active');
  assert.equal(getZoneByPercent(70).id, 'warm');
  assert.equal(getZoneByPercent(80).id, 'hot');
  assert.equal(getZoneByPercent(90).id, 'fire');
});

test('getZoneByPercent: returns rest for invalid inputs', () => {
  assert.equal(getZoneByPercent(null).id, 'rest');
  assert.equal(getZoneByPercent(NaN).id, 'rest');
  assert.equal(getZoneByPercent(undefined).id, 'rest');
});

// =============================================================================
// getZoneByBpm tests
// =============================================================================

test('getZoneByBpm: calculates zone from BPM and max HR', () => {
  const maxHr = 200;
  assert.equal(getZoneByBpm(80, maxHr).id, 'rest');   // 40%
  assert.equal(getZoneByBpm(110, maxHr).id, 'cool');  // 55%
  assert.equal(getZoneByBpm(130, maxHr).id, 'active'); // 65%
  assert.equal(getZoneByBpm(150, maxHr).id, 'warm');  // 75%
  assert.equal(getZoneByBpm(170, maxHr).id, 'hot');   // 85%
  assert.equal(getZoneByBpm(190, maxHr).id, 'fire');  // 95%
});

test('getZoneByBpm: uses default max HR of 190', () => {
  // 95 bpm with max 190 = 50% → cool
  assert.equal(getZoneByBpm(95).id, 'cool');
});

test('getZoneByBpm: handles invalid inputs', () => {
  assert.equal(getZoneByBpm(NaN, 200).id, 'rest');
  assert.equal(getZoneByBpm(100, 0).id, 'rest');
  assert.equal(getZoneByBpm(100, -1).id, 'rest');
});

// =============================================================================
// Governance status tests
// =============================================================================

test('GOVERNANCE_STATUS contains all status values', () => {
  assert.equal(GOVERNANCE_STATUS.GREEN, 'green');
  assert.equal(GOVERNANCE_STATUS.YELLOW, 'yellow');
  assert.equal(GOVERNANCE_STATUS.RED, 'red');
  assert.equal(GOVERNANCE_STATUS.GRAY, 'gray');
});

test('GOVERNANCE_PRIORITY provides correct ordering', () => {
  assert.ok(GOVERNANCE_PRIORITY.red > GOVERNANCE_PRIORITY.yellow);
  assert.ok(GOVERNANCE_PRIORITY.yellow > GOVERNANCE_PRIORITY.green);
  assert.ok(GOVERNANCE_PRIORITY.green > GOVERNANCE_PRIORITY.init);
});

test('compareGovernanceStatus: compares statuses correctly', () => {
  assert.ok(compareGovernanceStatus('red', 'green') > 0);
  assert.ok(compareGovernanceStatus('green', 'red') < 0);
  assert.equal(compareGovernanceStatus('yellow', 'yellow'), 0);
  assert.ok(compareGovernanceStatus('yellow', 'green') > 0);
});

test('compareGovernanceStatus: handles invalid inputs', () => {
  assert.equal(compareGovernanceStatus('unknown', 'unknown'), 0);
  assert.ok(compareGovernanceStatus('green', 'unknown') > 0);
});

// =============================================================================
// Timing constants tests
// =============================================================================

test('TIMING contains expected default values', () => {
  assert.equal(TIMING.CHALLENGE_COUNTDOWN_DEFAULT, 30000);
  assert.equal(TIMING.GRACE_PERIOD_DEFAULT, 30000);
  assert.equal(TIMING.AUTO_ACCEPT_DELAY, 5000);
  assert.equal(TIMING.TIMER_UPDATE_INTERVAL, 1000);
});

// =============================================================================
// Treasure coin tests
// =============================================================================

test('TREASURE_COIN_COLORS maps colors to hex values', () => {
  assert.equal(TREASURE_COIN_COLORS.red, '#ff6b6b');
  assert.equal(TREASURE_COIN_COLORS.green, '#51cf66');
  assert.equal(TREASURE_COIN_COLORS.blue, '#6ab8ff');
});

test('getCoinColorRank: returns correct intensity ranking', () => {
  assert.equal(getCoinColorRank('red'), 500);
  assert.equal(getCoinColorRank('orange'), 400);
  assert.equal(getCoinColorRank('yellow'), 300);
  assert.equal(getCoinColorRank('green'), 200);
  assert.equal(getCoinColorRank('blue'), 100);
});

test('getCoinColorRank: handles hex values', () => {
  assert.equal(getCoinColorRank('#ff6b6b'), 500);
  assert.equal(getCoinColorRank('#51cf66'), 200);
});

test('getCoinColorRank: returns 0 for unknown', () => {
  assert.equal(getCoinColorRank('purple'), 0);
  assert.equal(getCoinColorRank(null), 0);
  assert.equal(getCoinColorRank(undefined), 0);
});

// =============================================================================
// Layout constants tests
// =============================================================================

test('SIDEBAR_SIZE_MODE contains expected values', () => {
  assert.equal(SIDEBAR_SIZE_MODE.COMPACT, 'compact');
  assert.equal(SIDEBAR_SIZE_MODE.NORMAL, 'normal');
  assert.equal(SIDEBAR_SIZE_MODE.EXPANDED, 'expanded');
});

test('PLAYER_MODE contains expected values', () => {
  assert.equal(PLAYER_MODE.NORMAL, 'normal');
  assert.equal(PLAYER_MODE.FULLSCREEN, 'fullscreen');
  assert.equal(PLAYER_MODE.PIP, 'pip');
});
