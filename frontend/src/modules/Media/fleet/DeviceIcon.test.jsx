import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DeviceIcon, deviceIconComponent } from './DeviceIcon.jsx';
import { IconPiano, IconHeadphones, IconBarbell, IconDeviceTv } from '@tabler/icons-react';

describe('DeviceIcon', () => {
  it('maps configured emoji and device types to SVG icons', () => {
    expect(deviceIconComponent({ icon: '🎹' })).toBe(IconPiano);
    expect(deviceIconComponent({ icon: '🎧' })).toBe(IconHeadphones);
    expect(deviceIconComponent({ icon: '🏋️' })).toBe(IconBarbell);
    expect(deviceIconComponent({ type: 'shield-tv' })).toBe(IconDeviceTv);
    expect(deviceIconComponent(null)).toBe(IconDeviceTv);
  });
  it('renders an svg, never an emoji', () => {
    const { container } = render(<DeviceIcon device={{ icon: '📺' }} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toBe('');
  });
});
