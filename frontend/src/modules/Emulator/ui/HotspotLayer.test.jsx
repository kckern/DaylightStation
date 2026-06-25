import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { HotspotLayer } from './HotspotLayer.jsx';

const hotspots = [
  { id: 'speaker', action: 'volume', label: 'Volume', region: { x: 79.17, y: 64.81, width: 11.98, height: 22.22 } },
  { id: 'battery_led', do: { toast: 'Credit' }, region: { x: 19.58, y: 31.76, width: 2.29, height: 4.07 } },
  { id: 'dpad', region: { x: 2.34, y: 35.65, width: 10.68, height: 16.67 } }, // decorative: no action/do
];

describe('HotspotLayer', () => {
  it('renders a button only for actionable hotspots (skips decorative)', () => {
    const { container } = render(<HotspotLayer hotspots={hotspots} onActivate={() => {}} />);
    const buttons = container.querySelectorAll('.emu-hotspot');
    expect(buttons.length).toBe(2);
    expect(container.querySelector('[data-hotspot-id="dpad"]')).toBeNull();
  });

  it('positions each hotspot by its %-region and labels it', () => {
    const { container } = render(<HotspotLayer hotspots={hotspots} onActivate={() => {}} />);
    const speaker = container.querySelector('[data-hotspot-id="speaker"]');
    expect(speaker.getAttribute('aria-label')).toBe('Volume');
    expect(speaker.style.left).toBe('79.17%');
    expect(speaker.style.top).toBe('64.81%');
    expect(speaker.style.width).toBe('11.98%');
    expect(speaker.style.height).toBe('22.22%');
  });

  it('falls back to the id for the aria-label when no label is given', () => {
    const { container } = render(<HotspotLayer hotspots={hotspots} onActivate={() => {}} />);
    expect(container.querySelector('[data-hotspot-id="battery_led"]').getAttribute('aria-label')).toBe('battery_led');
  });

  it('calls onActivate with the hotspot when clicked', () => {
    const onActivate = vi.fn();
    const { container } = render(<HotspotLayer hotspots={hotspots} onActivate={onActivate} />);
    container.querySelector('[data-hotspot-id="speaker"]').click();
    expect(onActivate).toHaveBeenCalledWith(hotspots[0]);
  });

  it('renders nothing when there are no hotspots', () => {
    const { container } = render(<HotspotLayer hotspots={[]} onActivate={() => {}} />);
    expect(container.querySelector('.emu-hotspot')).toBeNull();
  });
});
