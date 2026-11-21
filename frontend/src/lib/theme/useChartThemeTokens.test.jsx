import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { readChartThemeTokens, useChartThemeTokens } from './useChartThemeTokens.js';

describe('chart theme tokens', () => {
  it('reads shared chart roles and falls back to info when accent is unset', () => {
    const element = document.createElement('div');
    element.style.setProperty('--ds-text-high', '#111111');
    element.style.setProperty('--ds-text-mid', '#555555');
    element.style.setProperty('--ds-text-low', '#888888');
    element.style.setProperty('--ds-border', '#333333');
    element.style.setProperty('--ds-surface', '#222222');
    element.style.setProperty('--ds-info', '#0088cc');
    element.style.setProperty('--ds-warning', '#ffaa00');
    document.body.appendChild(element);

    expect(readChartThemeTokens(element)).toEqual({
      textHigh: '#111111',
      textMid: '#555555',
      textLow: '#888888',
      border: '#333333',
      surface: '#222222',
      accent: '#0088cc',
      warning: '#ffaa00',
      info: '#0088cc',
    });
    element.remove();
  });

  it('reads tokens from the mounted chart host', async () => {
    function ChartHost() {
      const ref = useRef(null);
      const tokens = useChartThemeTokens(ref);
      return <div ref={ref} style={{ '--ds-accent': '#336699' }} data-testid="chart-host">
        {tokens?.accent ?? 'waiting'}
      </div>;
    }

    render(<ChartHost />);
    expect(await screen.findByText('#336699')).toBeInTheDocument();
  });
});
