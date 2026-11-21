import { describe, expect, it } from 'vitest';
import {
  DEVICE_TYPES,
  MEMBER_TYPES,
  MEMBER_GROUPS,
  deviceTypeBadgeColor,
  statusBadgeColor,
} from './constants.js';

describe('Admin household options', () => {
  it('defines device, member, and group choices once for their editors and badges', () => {
    expect(DEVICE_TYPES).toEqual([
      { value: 'shield-tv', label: 'Shield TV' },
      { value: 'linux-pc', label: 'Linux PC' },
      { value: 'midi-keyboard', label: 'MIDI Keyboard' },
    ]);
    expect(MEMBER_TYPES).toEqual([
      { value: 'owner', label: 'Owner' },
      { value: 'family_member', label: 'Family Member' },
    ]);
    expect(MEMBER_GROUPS).toEqual([
      { value: 'primary', label: 'Primary' },
      { value: 'secondary', label: 'Secondary' },
    ]);
  });
});

describe('deviceTypeBadgeColor', () => {
  it('uses the same Admin palette for known device types and a neutral fallback', () => {
    expect(deviceTypeBadgeColor('shield-tv')).toBe('blue');
    expect(deviceTypeBadgeColor('linux-pc')).toBe('green');
    expect(deviceTypeBadgeColor('midi-keyboard')).toBe('orange');
    expect(deviceTypeBadgeColor('unknown')).toBe('gray');
  });
});

describe('statusBadgeColor', () => {
  it('maps scheduler execution outcomes and unknown states to the Admin palette', () => {
    expect(statusBadgeColor('success')).toBe('green');
    expect(statusBadgeColor('failed')).toBe('red');
    expect(statusBadgeColor('queued')).toBe('gray');
  });
});
