import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ScreenProvider } from '@/screen-framework/providers/ScreenProvider.jsx';
import { ScreenDataContext } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { FitnessScreenProvider } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import FitnessSessionsWidget from './FitnessSessionsWidget.jsx';

const layout = { children: [{ id: 'left-area', children: [{ widget: 'fitness:sessions' }] }] };

describe('FitnessSessionsWidget episode duration', () => {
  it('shows the elapsed clock range and each participant measured time', () => {
    const sessions = { sessions: [{
      sessionId: 'group:20261007130000',
      date: '2026-10-07',
      startTime: Date.parse('2026-10-07T13:00:00Z'),
      endTime: Date.parse('2026-10-07T15:45:00Z'),
      elapsedMs: 165 * 60_000,
      durationMs: 80 * 60_000,
      timezone: 'UTC',
      participants: {
        'test-rider': { displayName: 'Test Rider', measuredDurationMs: 41 * 60_000 },
        'test-learner': { displayName: 'the learner', measuredDurationMs: 23 * 60_000 },
      },
    }] };
    const { getByText } = render(
      <MantineProvider><MemoryRouter>
        <FitnessScreenProvider onSelectedSessionConsumed={() => {}}>
          <ScreenDataContext.Provider value={{ sessions }}>
            <ScreenProvider config={layout}><FitnessSessionsWidget /></ScreenProvider>
          </ScreenDataContext.Provider>
        </FitnessScreenProvider>
      </MemoryRouter></MantineProvider>,
    );

    expect(getByText('2h 45m elapsed')).toBeTruthy();
    expect(getByText(/1:00pm.*3:45pm/)).toBeTruthy();
    expect(getByText('41m')).toBeTruthy();
    expect(getByText('23m')).toBeTruthy();
  });
});
