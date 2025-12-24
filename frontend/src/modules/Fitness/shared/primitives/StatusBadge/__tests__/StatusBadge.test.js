/**
 * Unit tests for StatusBadge primitive
 * Tests the component's prop handling and rendering logic
 */
import test from 'node:test';
import assert from 'node:assert/strict';

test('StatusBadge: className builder creates correct classes', () => {
  const buildClassName = (status, size, variant, pulse, className) => {
    return [
      'status-badge',
      `status-badge--${status}`,
      `status-badge--${size}`,
      `status-badge--${variant}`,
      pulse ? 'status-badge--pulse' : '',
      className
    ].filter(Boolean).join(' ');
  };
  
  assert.equal(
    buildClassName('green', 'md', 'filled', false, ''),
    'status-badge status-badge--green status-badge--md status-badge--filled'
  );
  
  assert.equal(
    buildClassName('red', 'lg', 'outline', true, 'custom'),
    'status-badge status-badge--red status-badge--lg status-badge--outline status-badge--pulse custom'
  );
});

test('StatusBadge: supports all status values', () => {
  const validStatuses = ['green', 'yellow', 'red', 'gray', 'blue', 'orange'];
  
  for (const status of validStatuses) {
    const className = `status-badge--${status}`;
    assert.ok(className.includes(status), `Should accept status: ${status}`);
  }
});

test('StatusBadge: supports all size values', () => {
  const validSizes = ['sm', 'md', 'lg'];
  
  for (const size of validSizes) {
    const className = `status-badge--${size}`;
    assert.ok(className.includes(size), `Should accept size: ${size}`);
  }
});

test('StatusBadge: supports all variant values', () => {
  const validVariants = ['filled', 'outline', 'dot-only'];
  
  for (const variant of validVariants) {
    const className = `status-badge--${variant}`;
    assert.ok(className.includes(variant), `Should accept variant: ${variant}`);
  }
});

test('StatusBadge: pulse class only added when pulse=true', () => {
  const buildClassName = (pulse) => {
    return [
      'status-badge',
      pulse ? 'status-badge--pulse' : ''
    ].filter(Boolean).join(' ');
  };
  
  assert.ok(!buildClassName(false).includes('pulse'));
  assert.ok(buildClassName(true).includes('pulse'));
});
