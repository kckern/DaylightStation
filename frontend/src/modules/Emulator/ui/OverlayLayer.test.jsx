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

describe('OverlayLayer — session kind', () => {
  const sessionOverlay = [{
    id: 'session', kind: 'session', anchor: 'top-left', offsetX: '2%', offsetY: '2%', scale: 0.5,
    fields: ['player', 'system_label', 'timer'],
  }];
  const fieldDescriptors = {
    player: { kind: 'player', name: 'KC', avatar: '/a.png' },
    system_label: { kind: 'text', text: 'Game Boy Color' },
    timer: { kind: 'stat', text: '11:49', unit: '', urgency: 'warn', stale: false },
  };
  const resolveField = (f) => fieldDescriptors[f];

  it('renders one field per listed name, in order', () => {
    const { container } = render(<OverlayLayer overlays={sessionOverlay} resolve={() => null} resolveField={resolveField} />);
    const el = container.querySelector('[data-overlay-id="session"]');
    expect(el.className).toContain('emu-overlay--session');
    const names = Array.from(el.querySelectorAll('.emu-overlay-session__field')).map((f) => f.className);
    expect(names[0]).toContain('--player');
    expect(names[1]).toContain('--system_label');
    expect(names[2]).toContain('--timer');
  });

  it('carries urgency onto the field that reports it', () => {
    const { container } = render(<OverlayLayer overlays={sessionOverlay} resolve={() => null} resolveField={resolveField} />);
    expect(container.querySelector('.emu-overlay-session__field--timer').className).toContain('is-warn');
  });

  it('renders nothing for a session overlay with an empty fields list', () => {
    const empty = [{ id: 'session', kind: 'session', fields: [] }];
    const { container } = render(<OverlayLayer overlays={empty} resolve={() => null} resolveField={resolveField} />);
    expect(container.querySelector('[data-overlay-id="session"]')).toBeNull();
  });

  it('skips one field that individually resolves empty, keeping the rest', () => {
    const partial = (f) => (f === 'system_label' ? { empty: true, text: '' } : fieldDescriptors[f]);
    const { container } = render(<OverlayLayer overlays={sessionOverlay} resolve={() => null} resolveField={partial} />);
    const el = container.querySelector('[data-overlay-id="session"]');
    expect(el.querySelectorAll('.emu-overlay-session__field').length).toBe(2);
  });
});
