/**
 * Unit tests for shared/utils/time.js
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTime,
  formatElapsed,
  parseTime,
  formatDuration,
  getElapsedSeconds,
  getCountdownRemaining,
  normalizeTimestamp
} from '../time.js';

// =============================================================================
// formatTime tests
// =============================================================================

test('formatTime: formats seconds to MM:SS by default (auto)', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(30), '00:30');
  assert.equal(formatTime(90), '01:30');
  assert.equal(formatTime(599), '09:59');
});

test('formatTime: formats to HH:MM:SS when hours present (auto)', () => {
  assert.equal(formatTime(3600), '01:00:00');
  assert.equal(formatTime(3661), '01:01:01');
  assert.equal(formatTime(7200), '02:00:00');
});

test('formatTime: forces MM:SS format even for large values', () => {
  assert.equal(formatTime(3661, { format: 'mm:ss' }), '61:01');
  assert.equal(formatTime(7200, { format: 'mm:ss' }), '120:00');
});

test('formatTime: forces HH:MM:SS format', () => {
  assert.equal(formatTime(30, { format: 'hh:mm:ss' }), '00:00:30');
  assert.equal(formatTime(90, { format: 'hh:mm:ss' }), '00:01:30');
});

test('formatTime: handles invalid inputs gracefully', () => {
  assert.equal(formatTime(null), '00:00');
  assert.equal(formatTime(undefined), '00:00');
  assert.equal(formatTime(NaN), '00:00');
  assert.equal(formatTime(-10), '00:00');
  assert.equal(formatTime(Infinity), '00:00');
});

test('formatTime: respects padHours option', () => {
  assert.equal(formatTime(3661, { format: 'hh:mm:ss', padHours: false }), '1:01:01');
  assert.equal(formatTime(3661, { format: 'hh:mm:ss', padHours: true }), '01:01:01');
});

test('formatTime: respects showZeroHours option', () => {
  assert.equal(formatTime(90, { showZeroHours: true }), '00:01:30');
  assert.equal(formatTime(90, { showZeroHours: false }), '01:30');
});

// =============================================================================
// parseTime tests
// =============================================================================

test('parseTime: parses MM:SS format', () => {
  assert.equal(parseTime('00:00'), 0);
  assert.equal(parseTime('01:30'), 90);
  assert.equal(parseTime('10:00'), 600);
});

test('parseTime: parses HH:MM:SS format', () => {
  assert.equal(parseTime('00:00:00'), 0);
  assert.equal(parseTime('01:00:00'), 3600);
  assert.equal(parseTime('01:01:01'), 3661);
});

test('parseTime: returns null for invalid inputs', () => {
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(undefined), null);
  assert.equal(parseTime('invalid'), null);
  assert.equal(parseTime('1:2:3:4'), null);
  assert.equal(parseTime('aa:bb'), null);
});

test('parseTime: handles whitespace', () => {
  assert.equal(parseTime('  01:30  '), 90);
});

// =============================================================================
// formatDuration tests
// =============================================================================

test('formatDuration: formats seconds in human-readable form', () => {
  assert.equal(formatDuration(0), '0 seconds');
  assert.equal(formatDuration(1), '1 second');
  assert.equal(formatDuration(30), '30 seconds');
  assert.equal(formatDuration(60), '1 minute');
  assert.equal(formatDuration(90), '1 minute, 30 seconds');
  assert.equal(formatDuration(3600), '1 hour');
  assert.equal(formatDuration(3661), '1 hour, 1 minute, 1 second');
});

test('formatDuration: compact format', () => {
  assert.equal(formatDuration(0, { compact: true }), '0s');
  assert.equal(formatDuration(90, { compact: true }), '1m 30s');
  assert.equal(formatDuration(3661, { compact: true }), '1h 1m 1s');
});

test('formatDuration: handles invalid inputs', () => {
  assert.equal(formatDuration(null), '0 seconds');
  assert.equal(formatDuration(NaN), '0 seconds');
  assert.equal(formatDuration(-10), '0 seconds');
});

// =============================================================================
// normalizeTimestamp tests
// =============================================================================

test('normalizeTimestamp: handles epoch milliseconds', () => {
  const now = Date.now();
  assert.equal(normalizeTimestamp(now), now);
});

test('normalizeTimestamp: handles Date objects', () => {
  const date = new Date('2025-01-01T00:00:00Z');
  assert.equal(normalizeTimestamp(date), date.getTime());
});

test('normalizeTimestamp: handles ISO strings', () => {
  const isoString = '2025-01-01T00:00:00Z';
  assert.equal(normalizeTimestamp(isoString), Date.parse(isoString));
});

test('normalizeTimestamp: returns null for invalid inputs', () => {
  assert.equal(normalizeTimestamp(null), null);
  assert.equal(normalizeTimestamp(undefined), null);
  assert.equal(normalizeTimestamp('not-a-date'), null);
  assert.equal(normalizeTimestamp(NaN), null);
});

// =============================================================================
// getElapsedSeconds tests
// =============================================================================

test('getElapsedSeconds: calculates elapsed time correctly', () => {
  const start = Date.now() - 5000; // 5 seconds ago
  const elapsed = getElapsedSeconds(start);
  assert.ok(elapsed >= 4 && elapsed <= 6, `Expected ~5 seconds, got ${elapsed}`);
});

test('getElapsedSeconds: handles custom end time', () => {
  const start = 1000;
  const end = 6000;
  assert.equal(getElapsedSeconds(start, end), 5);
});

test('getElapsedSeconds: returns 0 for invalid inputs', () => {
  assert.equal(getElapsedSeconds(null), 0);
  assert.equal(getElapsedSeconds(undefined), 0);
});

test('getElapsedSeconds: returns 0 for negative elapsed', () => {
  const start = Date.now() + 5000; // Future
  assert.equal(getElapsedSeconds(start), 0);
});

// =============================================================================
// formatElapsed tests
// =============================================================================

test('formatElapsed: formats elapsed time from timestamp', () => {
  const start = Date.now() - 90000; // 90 seconds ago
  const result = formatElapsed(start);
  // Should be around "01:30" (allowing for test execution time)
  assert.ok(result.includes(':'), `Expected time format, got ${result}`);
});

// =============================================================================
// getCountdownRemaining tests
// =============================================================================

test('getCountdownRemaining: calculates remaining time correctly', () => {
  const target = Date.now() + 5000; // 5 seconds in future
  const remaining = getCountdownRemaining(target);
  assert.ok(remaining >= 4 && remaining <= 5, `Expected ~5 seconds, got ${remaining}`);
});

test('getCountdownRemaining: returns 0 when past target', () => {
  const target = Date.now() - 5000; // 5 seconds ago
  assert.equal(getCountdownRemaining(target), 0);
});

test('getCountdownRemaining: returns 0 for invalid inputs', () => {
  assert.equal(getCountdownRemaining(null), 0);
  assert.equal(getCountdownRemaining(undefined), 0);
});
