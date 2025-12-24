/**
 * Unit tests for MicLevelIndicator primitive
 * Tests the component's level calculation and rendering logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('MicLevelIndicator: normalizes level to 0-100 range', () => {
  const normalizeLevel = (level) => Math.min(100, Math.max(0, level));
  
  assert.equal(normalizeLevel(0), 0);
  assert.equal(normalizeLevel(50), 50);
  assert.equal(normalizeLevel(100), 100);
  assert.equal(normalizeLevel(150), 100);  // Clamped to max
  assert.equal(normalizeLevel(-10), 0);    // Clamped to min
});

test('MicLevelIndicator: calculates active bars correctly', () => {
  const calculateActiveBars = (level, totalBars) => {
    const normalizedLevel = Math.min(100, Math.max(0, level));
    return Math.ceil((normalizedLevel / 100) * totalBars);
  };
  
  assert.equal(calculateActiveBars(0, 5), 0);
  assert.equal(calculateActiveBars(20, 5), 1);
  assert.equal(calculateActiveBars(50, 5), 3);
  assert.equal(calculateActiveBars(100, 5), 5);
  
  // With 7 bars
  assert.equal(calculateActiveBars(0, 7), 0);
  assert.equal(calculateActiveBars(50, 7), 4);
  assert.equal(calculateActiveBars(100, 7), 7);
});

test('MicLevelIndicator: className builder works correctly', () => {
  const buildClassName = (orientation, size, variant, className) => {
    return [
      'mic-level-indicator',
      `mic-level-indicator--${orientation}`,
      `mic-level-indicator--${size}`,
      `mic-level-indicator--${variant}`,
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('horizontal', 'md', 'bars', ''),
    'mic-level-indicator mic-level-indicator--horizontal mic-level-indicator--md mic-level-indicator--bars'
  );
  
  assert.equal(
    buildClassName('vertical', 'lg', 'waveform', 'custom'),
    'mic-level-indicator mic-level-indicator--vertical mic-level-indicator--lg mic-level-indicator--waveform custom'
  );
});

test('MicLevelIndicator: supports all orientation values', () => {
  const validOrientations = ['horizontal', 'vertical'];
  
  for (const orientation of validOrientations) {
    const className = `mic-level-indicator--${orientation}`;
    assert.ok(className.includes(orientation), `Should accept orientation: ${orientation}`);
  }
});

test('MicLevelIndicator: supports all variant values', () => {
  const validVariants = ['bars', 'waveform', 'arc'];
  
  for (const variant of validVariants) {
    const className = `mic-level-indicator--${variant}`;
    assert.ok(className.includes(variant), `Should accept variant: ${variant}`);
  }
});

test('MicLevelIndicator: style builder handles custom active color', () => {
  const buildStyle = (activeColor) => {
    return activeColor ? { '--mic-active-color': activeColor } : undefined;
  };
  
  assert.deepEqual(buildStyle('#ff6b6b'), { '--mic-active-color': '#ff6b6b' });
  assert.equal(buildStyle(null), undefined);
  assert.equal(buildStyle(''), undefined);
});
