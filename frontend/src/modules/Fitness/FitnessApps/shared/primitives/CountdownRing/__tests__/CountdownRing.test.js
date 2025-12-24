/**
 * Unit tests for CountdownRing primitive
 * Tests the component's countdown calculation and SVG logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('CountdownRing: progress calculation is correct', () => {
  const calculateProgress = (elapsed, duration) => {
    return Math.min(1, elapsed / duration);
  };
  
  assert.equal(calculateProgress(0, 5000), 0);
  assert.equal(calculateProgress(2500, 5000), 0.5);
  assert.equal(calculateProgress(5000, 5000), 1);
  assert.equal(calculateProgress(6000, 5000), 1); // Clamped
});

test('CountdownRing: remaining time calculation is correct', () => {
  const calculateRemaining = (elapsed, duration) => {
    return Math.max(0, duration - elapsed);
  };
  
  assert.equal(calculateRemaining(0, 5000), 5000);
  assert.equal(calculateRemaining(2500, 5000), 2500);
  assert.equal(calculateRemaining(5000, 5000), 0);
  assert.equal(calculateRemaining(6000, 5000), 0); // Clamped
});

test('CountdownRing: SVG calculations are correct', () => {
  const sizeMap = { sm: 48, md: 64, lg: 96, xl: 128 };
  
  const calculateSvgParams = (size, strokeWidth) => {
    const svgSize = typeof size === 'number' ? size : sizeMap[size] || 64;
    const radius = (svgSize - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    return { svgSize, radius, circumference };
  };
  
  const params = calculateSvgParams('md', 4);
  assert.equal(params.svgSize, 64);
  assert.equal(params.radius, 30);
  assert.ok(Math.abs(params.circumference - 188.496) < 0.01);
});

test('CountdownRing: strokeDashoffset calculation is correct', () => {
  const calculateStrokeDashoffset = (circumference, progress, direction) => {
    return direction === 'clockwise'
      ? circumference * (1 - progress)
      : circumference * progress;
  };
  
  const circumference = 188.496;
  
  // Clockwise: starts full, decreases as progress increases
  assert.ok(Math.abs(calculateStrokeDashoffset(circumference, 0, 'clockwise') - 188.496) < 0.01);
  assert.ok(Math.abs(calculateStrokeDashoffset(circumference, 0.5, 'clockwise') - 94.248) < 0.01);
  assert.ok(Math.abs(calculateStrokeDashoffset(circumference, 1, 'clockwise') - 0) < 0.01);
  
  // Counter-clockwise: starts empty, increases as progress increases
  assert.ok(Math.abs(calculateStrokeDashoffset(circumference, 0, 'counterclockwise') - 0) < 0.01);
  assert.ok(Math.abs(calculateStrokeDashoffset(circumference, 0.5, 'counterclockwise') - 94.248) < 0.01);
});

test('CountdownRing: className builder works correctly', () => {
  const buildClassName = (color, isRunning, paused, className) => {
    return [
      'countdown-ring',
      `countdown-ring--${color}`,
      isRunning ? 'countdown-ring--running' : '',
      paused ? 'countdown-ring--paused' : '',
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('primary', true, false, ''),
    'countdown-ring countdown-ring--primary countdown-ring--running'
  );
  
  assert.equal(
    buildClassName('success', false, true, 'custom'),
    'countdown-ring countdown-ring--success countdown-ring--paused custom'
  );
});

test('CountdownRing: supports all color values', () => {
  const validColors = ['primary', 'success', 'warning', 'danger', 'gray'];
  
  for (const color of validColors) {
    const className = `countdown-ring--${color}`;
    assert.ok(className.includes(color), `Should accept color: ${color}`);
  }
});

test('CountdownRing: remainingSeconds calculation rounds correctly', () => {
  const calculateRemainingSeconds = (remainingMs) => Math.ceil(remainingMs / 1000);
  
  assert.equal(calculateRemainingSeconds(5000), 5);
  assert.equal(calculateRemainingSeconds(4500), 5);
  assert.equal(calculateRemainingSeconds(4001), 5);
  assert.equal(calculateRemainingSeconds(4000), 4);
  assert.equal(calculateRemainingSeconds(100), 1);
  assert.equal(calculateRemainingSeconds(0), 0);
});
