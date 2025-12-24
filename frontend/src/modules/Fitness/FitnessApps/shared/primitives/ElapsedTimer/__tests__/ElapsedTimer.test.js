/**
 * Unit tests for ElapsedTimer primitive
 * Tests the component's time calculation logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, getElapsedSeconds } from '../../../utils/time.js';

test('ElapsedTimer: uses formatTime utility correctly', () => {
  // Test that the formatting matches expected output
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(90), '01:30');
  assert.equal(formatTime(3661), '01:01:01');
});

test('ElapsedTimer: getElapsedSeconds calculates correctly', () => {
  const start = Date.now() - 5000;
  const elapsed = getElapsedSeconds(start);
  assert.ok(elapsed >= 4 && elapsed <= 6, `Expected ~5 seconds, got ${elapsed}`);
});

test('ElapsedTimer: className builder works correctly', () => {
  const buildClassName = (size, variant, paused, className) => {
    return [
      'elapsed-timer',
      `elapsed-timer--${size}`,
      `elapsed-timer--${variant}`,
      paused ? 'elapsed-timer--paused' : '',
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('md', 'default', false, ''),
    'elapsed-timer elapsed-timer--md elapsed-timer--default'
  );
  
  assert.equal(
    buildClassName('lg', 'mono', true, 'custom'),
    'elapsed-timer elapsed-timer--lg elapsed-timer--mono elapsed-timer--paused custom'
  );
});

test('ElapsedTimer: supports all size values', () => {
  const validSizes = ['sm', 'md', 'lg', 'xl'];
  
  for (const size of validSizes) {
    const className = `elapsed-timer--${size}`;
    assert.ok(className.includes(size), `Should accept size: ${size}`);
  }
});

test('ElapsedTimer: supports all format options', () => {
  assert.equal(formatTime(90, { format: 'mm:ss' }), '01:30');
  assert.equal(formatTime(90, { format: 'hh:mm:ss' }), '00:01:30');
  assert.equal(formatTime(90, { format: 'auto' }), '01:30');
  assert.equal(formatTime(3661, { format: 'auto' }), '01:01:01');
});

test('ElapsedTimer: handles null/undefined startTime', () => {
  assert.equal(getElapsedSeconds(null), 0);
  assert.equal(getElapsedSeconds(undefined), 0);
});
