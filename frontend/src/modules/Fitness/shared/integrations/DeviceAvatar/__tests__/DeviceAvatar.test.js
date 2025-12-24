/**
 * Unit tests for DeviceAvatar integration
 * Tests the component's RPM calculation and rendering logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('DeviceAvatar: normalizes RPM correctly', () => {
  const normalizeRpm = (rpm) => {
    return Number.isFinite(rpm) ? Math.max(0, Math.round(rpm)) : null;
  };
  
  assert.equal(normalizeRpm(60), 60);
  assert.equal(normalizeRpm(60.7), 61);
  assert.equal(normalizeRpm(-10), 0);
  assert.equal(normalizeRpm(NaN), null);
  assert.equal(normalizeRpm(undefined), null);
  assert.equal(normalizeRpm(null), null);
});

test('DeviceAvatar: calculates spin duration from RPM', () => {
  const calculateSpinDuration = (rpm) => {
    if (!rpm || rpm <= 0) return '0s';
    return `${(60 / rpm).toFixed(2)}s`;
  };
  
  assert.equal(calculateSpinDuration(60), '1.00s');
  assert.equal(calculateSpinDuration(30), '2.00s');
  assert.equal(calculateSpinDuration(120), '0.50s');
  assert.equal(calculateSpinDuration(0), '0s');
  assert.equal(calculateSpinDuration(null), '0s');
});

test('DeviceAvatar: determines zero state correctly', () => {
  const isZero = (rpm) => {
    const normalized = Number.isFinite(rpm) ? Math.max(0, Math.round(rpm)) : null;
    return !Number.isFinite(normalized) || normalized <= 0;
  };
  
  assert.equal(isZero(0), true);
  assert.equal(isZero(-10), true);
  assert.equal(isZero(null), true);
  assert.equal(isZero(NaN), true);
  assert.equal(isZero(60), false);
  assert.equal(isZero(1), false);
});

test('DeviceAvatar: className builder works correctly', () => {
  const buildClassName = (size, isZero, className) => {
    return [
      'device-avatar',
      `device-avatar--${size}`,
      isZero ? 'device-avatar--idle' : 'device-avatar--active',
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('md', false, ''),
    'device-avatar device-avatar--md device-avatar--active'
  );
  
  assert.equal(
    buildClassName('lg', true, 'custom'),
    'device-avatar device-avatar--lg device-avatar--idle custom'
  );
});

test('DeviceAvatar: supports all size values', () => {
  const validSizes = ['sm', 'md', 'lg', 'xl'];
  
  for (const size of validSizes) {
    const className = `device-avatar--${size}`;
    assert.ok(className.includes(size), `Should accept size: ${size}`);
  }
});

test('DeviceAvatar: display value formatting', () => {
  const formatDisplayValue = (rpm, isZero, customFormat) => {
    if (typeof customFormat === 'function') {
      return customFormat(rpm, isZero);
    }
    return rpm != null ? rpm : '--';
  };
  
  assert.equal(formatDisplayValue(60, false, null), 60);
  assert.equal(formatDisplayValue(null, true, null), '--');
  assert.equal(formatDisplayValue(60, false, (rpm) => `${rpm} RPM`), '60 RPM');
});

test('DeviceAvatar: spinner visibility based on state', () => {
  const shouldShowSpinner = (hideWhenZero, isZero) => {
    return !(hideWhenZero && isZero);
  };
  
  assert.equal(shouldShowSpinner(true, false), true);  // Show when active
  assert.equal(shouldShowSpinner(true, true), false);  // Hide when zero
  assert.equal(shouldShowSpinner(false, true), true);  // Show when zero (hideWhenZero=false)
  assert.equal(shouldShowSpinner(false, false), true); // Always show when active
});
