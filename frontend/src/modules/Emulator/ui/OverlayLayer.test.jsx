import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { OverlayLayer } from './OverlayLayer.jsx';

const overlays = [
  { id: 'hr', region: { x: 15.1, y: 43.52, width: 12.24, height: 15.74 } },
  { id: 'player', region: { x: 71.77, y: 12.04, width: 12.19, height: 18.52 } },
  { id: 'rpm', region: { x: 15.63, y: 11.11, width: 11.72, height: 16.67 } },
];

const descriptors = {
  hr: { kind: 'stat', text: '142', unit: 'BPM' },
  player: { kind: 'player', name: 'KC', avatar: '/a.png' },
  rpm: { empty: true, text: '' },
};

const resolve = (o) => descriptors[o.id];

describe('OverlayLayer', () => {
  it('renders one positioned box per overlay, tagged by id', () => {
    const { container } = render(<OverlayLayer overlays={overlays} resolve={resolve} />);
    expect(container.querySelectorAll('.emu-overlay').length).toBe(3);
    const hr = container.querySelector('[data-overlay-id="hr"]');
    expect(hr.style.left).toBe('15.1%');
    expect(hr.style.top).toBe('43.52%');
  });

  it('renders a stat value with its unit', () => {
    const { container } = render(<OverlayLayer overlays={overlays} resolve={resolve} />);
    const hr = container.querySelector('[data-overlay-id="hr"]');
    expect(hr.className).toContain('emu-overlay--stat');
    expect(hr.querySelector('.emu-overlay__value').textContent).toBe('142');
    expect(hr.querySelector('.emu-overlay__unit').textContent).toBe('BPM');
  });

  it('renders a player card with name and avatar', () => {
    const { container } = render(<OverlayLayer overlays={overlays} resolve={resolve} />);
    const player = container.querySelector('[data-overlay-id="player"]');
    expect(player.className).toContain('emu-overlay--player');
    expect(player.querySelector('.emu-overlay__name').textContent).toBe('KC');
    expect(player.querySelector('img.emu-overlay__avatar').getAttribute('src')).toBe('/a.png');
  });

  it('marks empty overlays and renders no value', () => {
    const { container } = render(<OverlayLayer overlays={overlays} resolve={resolve} />);
    const rpm = container.querySelector('[data-overlay-id="rpm"]');
    expect(rpm.className).toContain('is-empty');
    expect(rpm.querySelector('.emu-overlay__value')).toBeNull();
  });

  it('renders nothing when there are no overlays', () => {
    const { container } = render(<OverlayLayer overlays={[]} resolve={resolve} />);
    expect(container.querySelector('.emu-overlay')).toBeNull();
  });
});
