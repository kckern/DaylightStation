import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { ScreenProvider } from "../../../../../../__capabilities/screen-host/browser/providers/ScreenProvider.jsx";
import { ScreenDataContext } from "../../../../../../__capabilities/screen-host/browser/data/ScreenDataProvider.jsx";
import { FitnessScreenProvider } from "../../FitnessScreenProvider.jsx";
import FitnessSessionsWidget from "./FitnessSessionsWidget.jsx";

const layout = { children: [{ id: 'left-area', children: [{ widget: 'fitness:sessions' }] }] };

function rider(n, minutes) {
  return [`rider-${n}`, { displayName: `Rider ${n}`, measuredDurationMs: minutes * 60_000 }];
}

function renderRow(overrides) {
  const sessions = { sessions: [{
    sessionId: 'group:20261014185624',
    date: '2026-10-14',
    startTime: Date.parse('2026-10-14T18:56:00Z'),
    endTime: Date.parse('2026-10-14T19:23:00Z'),
    elapsedMs: 27 * 60_000,
    timezone: 'UTC',
    totalRings: 1152,
    maxSufferScore: 12,
    ...overrides,
  }] };
  return render(
    <MantineProvider><MemoryRouter>
      <FitnessScreenProvider onSelectedSessionConsumed={() => {}}>
        <ScreenDataContext.Provider value={{ sessions }}>
          <ScreenProvider config={layout}><FitnessSessionsWidget /></ScreenProvider>
        </ScreenDataContext.Provider>
      </FitnessScreenProvider>
    </MemoryRouter></MantineProvider>,
  );
}

describe('FitnessSessionsWidget row layout', () => {
  it('keeps the totals out of the rider group so riders, not totals, are what clips', () => {
    const { container } = renderRow({
      participants: Object.fromEntries([rider(1, 23), rider(2, 20), rider(3, 17), rider(4, 17), rider(5, 9)]),
    });
    const riders = container.querySelector('.session-row__riders');
    const totals = container.querySelector('.session-row__totals');
    expect(riders.classList.contains('session-row__riders--stacked')).toBe(true);
    expect(riders.contains(totals)).toBe(false);
    expect(totals.querySelector('.session-row__rings').textContent).toContain('1152');
    expect(totals.querySelector('.session-row__suffer').textContent).toContain('12');
    // Stacked riders carry their minutes in the tooltip instead of a label.
    expect(container.querySelectorAll('.session-row__participant-time')).toHaveLength(0);
    expect(riders.querySelector('img[title="Rider 1 · 23m"]')).toBeTruthy();
  });

  it('keeps per-rider minutes inline for one or two riders', () => {
    const { container, getByText } = renderRow({
      participants: Object.fromEntries([rider(1, 23), rider(2, 20)]),
    });
    expect(container.querySelector('.session-row__riders--stacked')).toBeNull();
    expect(getByText('23m')).toBeTruthy();
    expect(getByText('20m')).toBeTruthy();
  });

  it('gives a voice memo its own line and keeps the time line beside it', () => {
    const { container } = renderRow({
      participants: Object.fromEntries([rider(1, 27)]),
      voiceMemos: [{ transcript: 'We finished the graffiti cup together.' }],
    });
    const meta = container.querySelector('.session-row__meta');
    const memo = container.querySelector('.session-row__memo-line');
    expect(meta.textContent).toMatch(/6:56pm.*7:23pm/);
    expect(memo.textContent).toContain('We finished the graffiti cup together.');
    expect(memo.textContent).not.toMatch(/6:56pm/);
  });
});

describe('FitnessSessionsWidget date groups', () => {
  it('puts a day\'s sessions under one header even when they are not adjacent', () => {
    const sessions = { sessions: [
      { sessionId: '20260811193519', date: '2026-08-11', startTime: Date.parse('2026-08-11T19:35:00Z'), timezone: 'UTC' },
      { sessionId: '20260712185213', date: '2026-07-12', startTime: Date.parse('2026-07-12T18:52:00Z'), timezone: 'UTC' },
      { sessionId: '20260811193338', date: '2026-08-11' },
    ] };
    const { container } = render(
      <MantineProvider><MemoryRouter>
        <FitnessScreenProvider onSelectedSessionConsumed={() => {}}>
          <ScreenDataContext.Provider value={{ sessions }}>
            <ScreenProvider config={layout}><FitnessSessionsWidget /></ScreenProvider>
          </ScreenDataContext.Provider>
        </FitnessScreenProvider>
      </MemoryRouter></MantineProvider>,
    );
    const dates = [...container.querySelectorAll('[data-date]')].map((g) => g.dataset.date);
    expect(dates).toEqual(['2026-08-11', '2026-07-12']);
    expect(container.querySelectorAll('[data-date="2026-08-11"] .session-row')).toHaveLength(2);
  });
});
