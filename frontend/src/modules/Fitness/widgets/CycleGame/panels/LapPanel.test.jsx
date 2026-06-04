import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LapPanel from './LapPanel.jsx';

const riders = {
  user_3: { userId: 'user_3', displayName: 'User_3', cumulativeDistanceM: 1500 },
  user_2: { userId: 'user_2', displayName: 'User_2', cumulativeDistanceM: 900 }
};

describe('LapPanel', () => {
  it('renders the oval and the lap table together in one panel', () => {
    const { getByTestId } = render(
      <LapPanel
        riderIds={['user_3', 'user_2']}
        riders={riders}
        riderLive={{ user_3: {}, user_2: {} }}
        progress={{ user_3: 0.5, user_2: 0.3 }}
        lapSplits={{ user_3: [60, 125], user_2: [64] }}
      />
    );
    const panel = getByTestId('lap-panel');
    expect(panel.querySelector('[data-testid="oval-track"]')).toBeTruthy();
    expect(panel.querySelector('[data-testid="lap-table"]')).toBeTruthy();
  });
});
