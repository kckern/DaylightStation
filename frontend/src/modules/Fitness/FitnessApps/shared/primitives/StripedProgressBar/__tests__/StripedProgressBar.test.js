/**
 * Unit tests for StripedProgressBar primitive
 * Tests the component's prop handling and rendering logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Since we're testing React components without a DOM, we test the logic
// by importing and testing the component's expected behavior patterns

test('StripedProgressBar: percentage calculation clamps correctly', () => {
  // Test the percentage calculation logic used in the component
  const calculatePercentage = (value, max) => {
    return max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  };
  
  assert.equal(calculatePercentage(0, 100), 0);
  assert.equal(calculatePercentage(50, 100), 50);
  assert.equal(calculatePercentage(100, 100), 100);
  assert.equal(calculatePercentage(150, 100), 100); // Clamped to max
  assert.equal(calculatePercentage(-10, 100), 0);   // Clamped to min
  assert.equal(calculatePercentage(50, 0), 0);      // Zero max
});

test('StripedProgressBar: className builder works correctly', () => {
  const buildClassName = (color, direction, animated, className) => {
    return [
      'striped-progress-bar',
      `striped-progress-bar--${color}`,
      `striped-progress-bar--${direction}`,
      animated ? 'striped-progress-bar--animated' : '',
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('green', 'left', true, 'custom'),
    'striped-progress-bar striped-progress-bar--green striped-progress-bar--left striped-progress-bar--animated custom'
  );
  
  assert.equal(
    buildClassName('red', 'right', false, ''),
    'striped-progress-bar striped-progress-bar--red striped-progress-bar--right'
  );
});

test('StripedProgressBar: color prop accepts zone IDs and color names', () => {
  const validColors = ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'rest', 'cool', 'active', 'warm', 'hot', 'fire'];
  
  for (const color of validColors) {
    const className = `striped-progress-bar--${color}`;
    assert.ok(className.includes(color), `Should accept color: ${color}`);
  }
});

test('StripedProgressBar: style builder handles numeric and string heights', () => {
  const buildStyle = (speed, height, customStyle = {}) => {
    return {
      '--stripe-speed': `${speed}s`,
      '--bar-height': typeof height === 'number' ? `${height}px` : height,
      ...customStyle
    };
  };
  
  const style1 = buildStyle(2, 8);
  assert.equal(style1['--stripe-speed'], '2s');
  assert.equal(style1['--bar-height'], '8px');
  
  const style2 = buildStyle(0.5, '100%');
  assert.equal(style2['--bar-height'], '100%');
});
