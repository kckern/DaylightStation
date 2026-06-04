import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LapPanel from './LapPanel.jsx';

const riders = {
  milo: { userId: 'milo', displayName: 'Milo', cumulativeDistanceM: 1500 },
  felix: { userId: 'felix', displayName: 'Felix', cumulativeDistanceM: 900 }
};

describe('LapPanel', () => {
  it('renders the oval and the lap table together in one panel', () => {
    const { getByTestId } = render(
      <LapPanel
        riderIds={['milo', 'felix']}
        riders={riders}
        riderLive={{ milo: {}, felix: {} }}
        progress={{ milo: 0.5, felix: 0.3 }}
        lapSplits={{ milo: [60, 125], felix: [64] }}
      />
    );
    const panel = getByTestId('lap-panel');
    expect(panel.querySelector('[data-testid="oval-track"]')).toBeTruthy();
    expect(panel.querySelector('[data-testid="lap-table"]')).toBeTruthy();
  });
});
