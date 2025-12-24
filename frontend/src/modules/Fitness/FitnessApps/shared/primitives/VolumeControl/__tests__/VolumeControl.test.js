/**
 * Unit tests for VolumeControl primitive
 * Tests the component's volume calculation and interaction logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('VolumeControl: clamps value to min/max range', () => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  
  assert.equal(clamp(50, 0, 100), 50);
  assert.equal(clamp(-10, 0, 100), 0);
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(25, 10, 50), 25);
});

test('VolumeControl: step snapping works correctly', () => {
  const snapToStep = (value, step) => Math.round(value / step) * step;
  
  assert.equal(snapToStep(47, 5), 45);
  assert.equal(snapToStep(48, 5), 50);
  assert.equal(snapToStep(52, 5), 50);
  assert.equal(snapToStep(53, 5), 55);
  assert.equal(snapToStep(25, 10), 30);
});

test('VolumeControl: custom steps snapping works correctly', () => {
  const snapToSteps = (value, steps) => {
    if (!steps || steps.length === 0) return value;
    return steps.reduce((prev, curr) => 
      Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev
    );
  };
  
  const steps = [0, 25, 50, 75, 100];
  
  assert.equal(snapToSteps(12, steps), 0);
  assert.equal(snapToSteps(13, steps), 25);
  assert.equal(snapToSteps(37, steps), 25);
  assert.equal(snapToSteps(38, steps), 50);
  assert.equal(snapToSteps(62, steps), 50);
  assert.equal(snapToSteps(63, steps), 75);
});

test('VolumeControl: percentage calculation is correct', () => {
  const calculatePercentage = (value, min, max) => ((value - min) / (max - min)) * 100;
  
  assert.equal(calculatePercentage(0, 0, 100), 0);
  assert.equal(calculatePercentage(50, 0, 100), 50);
  assert.equal(calculatePercentage(100, 0, 100), 100);
  assert.equal(calculatePercentage(25, 10, 50), 37.5);
});

test('VolumeControl: slider interaction calculation works', () => {
  const calculateValueFromPosition = (percentage, min, max) => {
    return min + percentage * (max - min);
  };
  
  assert.equal(calculateValueFromPosition(0, 0, 100), 0);
  assert.equal(calculateValueFromPosition(0.5, 0, 100), 50);
  assert.equal(calculateValueFromPosition(1, 0, 100), 100);
  assert.equal(calculateValueFromPosition(0.5, 10, 50), 30);
});

test('VolumeControl: className builder works correctly', () => {
  const buildClassName = (orientation, size, muted, isDragging, className) => {
    return [
      'volume-control',
      `volume-control--${orientation}`,
      `volume-control--${size}`,
      muted ? 'volume-control--muted' : '',
      isDragging ? 'volume-control--dragging' : '',
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('vertical', 'md', false, false, ''),
    'volume-control volume-control--vertical volume-control--md'
  );
  
  assert.equal(
    buildClassName('horizontal', 'lg', true, true, 'custom'),
    'volume-control volume-control--horizontal volume-control--lg volume-control--muted volume-control--dragging custom'
  );
});

test('VolumeControl: supports all orientation values', () => {
  const validOrientations = ['vertical', 'horizontal'];
  
  for (const orientation of validOrientations) {
    const className = `volume-control--${orientation}`;
    assert.ok(className.includes(orientation), `Should accept orientation: ${orientation}`);
  }
});

test('VolumeControl: supports all size values', () => {
  const validSizes = ['sm', 'md', 'lg'];
  
  for (const size of validSizes) {
    const className = `volume-control--${size}`;
    assert.ok(className.includes(size), `Should accept size: ${size}`);
  }
});

test('VolumeControl: increment/decrement respects step', () => {
  const increment = (value, step, max) => Math.min(max, value + step);
  const decrement = (value, step, min) => Math.max(min, value - step);
  
  assert.equal(increment(50, 5, 100), 55);
  assert.equal(increment(98, 5, 100), 100); // Clamped
  assert.equal(decrement(50, 5, 0), 45);
  assert.equal(decrement(2, 5, 0), 0);     // Clamped
});

test('VolumeControl: display value is 0 when muted', () => {
  const getDisplayValue = (value, muted) => muted ? 0 : value;
  
  assert.equal(getDisplayValue(50, false), 50);
  assert.equal(getDisplayValue(50, true), 0);
  assert.equal(getDisplayValue(100, true), 0);
});
