// frontend/src/screen-framework/panels/PanelRenderer.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PanelRenderer } from './PanelRenderer.jsx';

// Mock widget registry
vi.mock('../widgets/registry.js', () => {
  const MockClock = () => <div data-testid="widget-clock">Clock</div>;
  const MockWeather = () => <div data-testid="widget-weather">Weather</div>;
  const MockFinance = () => <div data-testid="widget-finance">Finance</div>;

  const widgets = new Map([
    ['clock', MockClock],
    ['weather', MockWeather],
    ['finance', MockFinance],
  ]);

  return {
    getWidgetRegistry: () => ({
      get: (name) => widgets.get(name) || null,
      has: (name) => widgets.has(name),
    }),
  };
});

describe('PanelRenderer', () => {
  it('renders a single widget leaf node', () => {
    const node = { widget: 'clock', grow: 0 };
    render(<PanelRenderer node={node} />);
    expect(screen.getByTestId('widget-clock')).toBeTruthy();
  });

  it('renders nested panels with children', () => {
    const node = {
      direction: 'row',
      gap: '1rem',
      children: [
        { widget: 'clock', grow: 0 },
        { widget: 'weather', grow: 1 },
      ],
    };
    render(<PanelRenderer node={node} />);
    expect(screen.getByTestId('widget-clock')).toBeTruthy();
    expect(screen.getByTestId('widget-weather')).toBeTruthy();
  });

  it('applies flex properties to panel container', () => {
    const node = {
      direction: 'column',
      gap: '0.5rem',
      justify: 'center',
      align: 'flex-start',
      children: [{ widget: 'clock' }],
    };
    const { container } = render(<PanelRenderer node={node} />);
    const panel = container.firstChild;
    expect(panel.style.flexDirection).toBe('column');
    expect(panel.style.gap).toBe('0.5rem');
    expect(panel.style.justifyContent).toBe('center');
    expect(panel.style.alignItems).toBe('flex-start');
  });

  it('applies flex-grow/shrink/basis to widget wrapper', () => {
    const node = { widget: 'clock', grow: 0, shrink: 0, basis: '25%' };
    const { container } = render(<PanelRenderer node={node} />);
    const wrapper = container.firstChild;
    expect(wrapper.style.flexGrow).toBe('0');
    expect(wrapper.style.flexShrink).toBe('0');
    expect(wrapper.style.flexBasis).toBe('25%');
  });

  it('renders deeply nested panels (3 levels)', () => {
    const node = {
      direction: 'row',
      children: [
        {
          direction: 'column',
          children: [
            { widget: 'clock' },
            { widget: 'weather' },
          ],
        },
        { widget: 'finance' },
      ],
    };
    render(<PanelRenderer node={node} />);
    expect(screen.getByTestId('widget-clock')).toBeTruthy();
    expect(screen.getByTestId('widget-weather')).toBeTruthy();
    expect(screen.getByTestId('widget-finance')).toBeTruthy();
  });

  it('applies per-panel theme overrides as CSS custom properties', () => {
    const node = {
      widget: 'clock',
      theme: {
        'panel-bg': 'rgba(0, 40, 0, 0.6)',
        'accent-color': '#66bb6a',
      },
    };
    const { container } = render(<PanelRenderer node={node} />);
    const wrapper = container.firstChild;
    expect(wrapper.style.getPropertyValue('--screen-panel-bg')).toBe('rgba(0, 40, 0, 0.6)');
    expect(wrapper.style.getPropertyValue('--screen-accent-color')).toBe('#66bb6a');
  });

  it('skips unregistered widgets without crashing', () => {
    const node = {
      direction: 'row',
      children: [
        { widget: 'clock' },
        { widget: 'nonexistent' },
      ],
    };
    render(<PanelRenderer node={node} />);
    expect(screen.getByTestId('widget-clock')).toBeTruthy();
  });
});
