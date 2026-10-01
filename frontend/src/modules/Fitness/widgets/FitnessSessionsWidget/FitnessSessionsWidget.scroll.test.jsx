import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { ScreenProvider } from '@/screen-framework/providers/ScreenProvider.jsx';
import { ScreenDataContext } from '@/screen-framework/data/ScreenDataProvider.jsx';
import { FitnessScreenProvider } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import FitnessSessionsWidget from './FitnessSessionsWidget.jsx';

const layout = {
  children: [
    { id: 'left-area', children: [{ widget: 'fitness:sessions' }] },
    { id: 'right-area', children: [{ widget: 'fitness:momentum' }] },
  ],
};

const row = (sessionId, date = '2026-09-30') => ({ sessionId, date, participants: {} });

function tree(store, selected = 's1') {
  return (
    <MantineProvider><MemoryRouter initialEntries={['/fitness/home']}>
      <FitnessScreenProvider initialSelectedSessionId={selected} onSelectedSessionConsumed={() => {}}>
        <ScreenDataContext.Provider value={store}>
          <ScreenProvider config={layout}>
            <FitnessSessionsWidget />
          </ScreenProvider>
        </ScreenDataContext.Provider>
      </FitnessScreenProvider>
    </MemoryRouter></MantineProvider>
  );
}

describe('FitnessSessionsWidget — selected row scroll', () => {
  let scrolled;
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this.getAttribute('data-session-id'));
    };
  });
  afterEach(() => { Element.prototype.scrollIntoView = original; });

  it('scrolls to the selected row once, not again on each data refresh', () => {
    const { rerender } = render(tree({ sessions: { sessions: [row('s1'), row('s2')] } }));
    expect(scrolled).toEqual(['s1']);

    // Two list refreshes (new store objects, same rows): the list must not yank back.
    act(() => { rerender(tree({ sessions: { sessions: [row('s1'), row('s2')] } })); });
    act(() => { rerender(tree({ sessions: { sessions: [row('s0'), row('s1'), row('s2')] } })); });
    expect(scrolled).toEqual(['s1']);
  });

  it('scrolls when the selected row first appears in a refreshed list', () => {
    // Post-session landing: selection set before the stale cached list has the row.
    const { rerender } = render(tree({ sessions: { sessions: [row('s2')] } }));
    expect(scrolled).toEqual([]);

    act(() => { rerender(tree({ sessions: { sessions: [row('s1'), row('s2')] } })); });
    expect(scrolled).toEqual(['s1']);
  });
});
