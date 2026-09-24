import { describe, it, expect, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { ScreenProvider, ScreenContext } from '@/screen-framework/providers/ScreenProvider.jsx';
import { FitnessScreenProvider } from '@/modules/Fitness/FitnessScreenProvider.jsx';
import FitnessSessionsWidget from './FitnessSessionsWidget.jsx';
import { sessionDetailSeed, SESSION_DETAIL_NODE_ID } from './sessionDetailPane.js';

const layout = {
  children: [
    { id: 'left-area', children: [{ widget: 'fitness:sessions' }] },
    { id: 'right-area', children: [{ widget: 'fitness:momentum' }] },
  ],
};

// Records every replacement stack the right-area node has had, so a test can
// see whether the default content was ever swapped in and out.
function Probe({ onState }) {
  const ctx = React.useContext(ScreenContext);
  onState(ctx.replacements[SESSION_DETAIL_NODE_ID] || []);
  return null;
}

function renderHome({ selected, seed }) {
  const states = [];
  const utils = render(
    <MantineProvider><MemoryRouter initialEntries={['/fitness/home']}>
      <FitnessScreenProvider initialSelectedSessionId={selected} onSelectedSessionConsumed={() => {}}>
        <ScreenProvider config={layout} initialReplacements={seed}>
          <FitnessSessionsWidget />
          <Probe onState={(s) => states.push(s)} />
        </ScreenProvider>
      </FitnessScreenProvider>
    </MemoryRouter></MantineProvider>,
  );
  return { states, ...utils };
}

describe('FitnessSessionsWidget outside selection', () => {
  it('adopts a pane seeded at mount instead of pushing a duplicate', () => {
    const { states } = renderHome({ selected: 's1', seed: sessionDetailSeed('s1') });

    // Detail from the very first render, and exactly one entry the whole time.
    expect(states.every((stack) => stack.length === 1)).toBe(true);
    expect(states.at(-1)[0].subtree.children[0].props.sessionId).toBe('s1');
  });

  it('opens the detail pane for an outside selection with no seed', () => {
    const { states } = renderHome({ selected: 's2', seed: undefined });
    const last = states.at(-1);
    expect(last).toHaveLength(1);
    expect(last[0].subtree.children[0].props.sessionId).toBe('s2');
  });

  it('swaps the pane when the outside selection changes to another session', () => {
    const states = [];
    const tree = (selected) => (
      <MantineProvider><MemoryRouter initialEntries={['/fitness/home']}>
        <FitnessScreenProvider initialSelectedSessionId={selected} onSelectedSessionConsumed={() => {}}>
          <ScreenProvider config={layout}>
            <FitnessSessionsWidget />
            <Probe onState={(s) => states.push(s)} />
          </ScreenProvider>
        </FitnessScreenProvider>
      </MemoryRouter></MantineProvider>
    );
    const { rerender } = render(tree('s1'));
    act(() => { rerender(tree('s2')); });

    const last = states.at(-1);
    expect(last).toHaveLength(1);
    expect(last[0].subtree.children[0].props.sessionId).toBe('s2');
  });

  it('clears the selection and URL when the pane is closed from outside (detail × button)', () => {
    const states = [];
    let restore;
    let path;
    function Closer() {
      restore = React.useContext(ScreenContext).restore;
      path = useLocation().pathname;
      return null;
    }
    render(
      <MantineProvider><MemoryRouter initialEntries={['/fitness/home/session-s1']}>
        <FitnessScreenProvider initialSelectedSessionId="s1" onSelectedSessionConsumed={() => {}}>
          <ScreenProvider config={layout} initialReplacements={sessionDetailSeed('s1')}>
            <FitnessSessionsWidget />
            <Probe onState={(s) => states.push(s)} />
            <Closer />
          </ScreenProvider>
        </FitnessScreenProvider>
      </MemoryRouter></MantineProvider>,
    );
    expect(states.at(-1)).toHaveLength(1);

    act(() => restore(SESSION_DETAIL_NODE_ID));

    expect(states.at(-1)).toHaveLength(0);
    expect(path).toBe('/fitness/home');
  });

  it('does not treat a pane that has not rendered yet as closed', () => {
    const { states } = renderHome({ selected: 's2', seed: undefined });
    // Opened by the widget's own effect: the pane must survive its first commit.
    expect(states.at(-1)).toHaveLength(1);
  });

  // Mounts the seeded home at /fitness/home/session-s1 and exposes the router's
  // navigate + current path, like the post-session redirect / browser Back would drive them.
  function renderSeededWithRouter() {
    const states = [];
    const nav = {};
    function RouterHandle() {
      nav.navigate = useNavigate();
      nav.path = useLocation().pathname;
      return null;
    }
    const utils = render(
      <MantineProvider><MemoryRouter initialEntries={['/fitness/home/session-s1']}>
        <FitnessScreenProvider initialSelectedSessionId="s1" onSelectedSessionConsumed={() => {}}>
          <ScreenProvider config={layout} initialReplacements={sessionDetailSeed('s1')}>
            <FitnessSessionsWidget />
            <Probe onState={(s) => states.push(s)} />
            <RouterHandle />
          </ScreenProvider>
        </FitnessScreenProvider>
      </MemoryRouter></MantineProvider>,
    );
    return { states, nav, ...utils };
  }

  it('closes the pane and clears the selection when the URL drops the session (no-session redirect, browser Back)', () => {
    const { states, nav, container } = renderSeededWithRouter();
    expect(states.at(-1)).toHaveLength(1);

    act(() => nav.navigate('/fitness/home', { replace: true }));

    expect(states.at(-1)).toHaveLength(0);
    expect(nav.path).toBe('/fitness/home');
    expect(container.querySelector('.session-row--selected')).toBeNull();
  });

  it('keeps the seeded pane open on mount at /fitness/home/session-s1', () => {
    const { states, nav } = renderSeededWithRouter();
    expect(states.every((stack) => stack.length === 1)).toBe(true);
    expect(nav.path).toBe('/fitness/home/session-s1');
  });

  it('switching to another session URL does not close the pane', () => {
    const { states, nav } = renderSeededWithRouter();
    act(() => nav.navigate('/fitness/home/session-s9', { replace: true }));
    // The URL still names a session, so the URL effect leaves the pane alone.
    expect(states.at(-1)).toHaveLength(1);
  });

  it('opening a row by click and toggling it off both survive the URL effect', async () => {
    const { ScreenDataContext } = await import('@/screen-framework/data/ScreenDataProvider.jsx');
    const sessions = { sessions: [{ sessionId: 's7', date: '2026-09-24', startTime: Date.now(), media: [], participants: {} }] };
    const states = [];
    const nav = {};
    function RouterHandle() { nav.path = useLocation().pathname; return null; }
    const { container } = render(
      <MantineProvider><MemoryRouter initialEntries={['/fitness/home']}>
        <ScreenDataContext.Provider value={{ sessions }}>
          <FitnessScreenProvider onSelectedSessionConsumed={() => {}}>
            <ScreenProvider config={layout}>
              <FitnessSessionsWidget />
              <Probe onState={(s) => states.push(s)} />
              <RouterHandle />
            </ScreenProvider>
          </FitnessScreenProvider>
        </ScreenDataContext.Provider>
      </MemoryRouter></MantineProvider>,
    );
    const row = container.querySelector('.session-row:not(.session-row--skeleton)');
    expect(row).not.toBeNull();

    // Rows are wired to onPointerDown, not onClick — .click() only synthesizes
    // a 'click' event in happy-dom, so fire the pointer event the row actually
    // listens for.
    act(() => { fireEvent.pointerDown(row); });
    expect(nav.path).toBe('/fitness/home/session-s7');
    expect(states.at(-1)).toHaveLength(1);

    act(() => { fireEvent.pointerDown(container.querySelector('.session-row--selected')); });
    expect(nav.path).toBe('/fitness/home');
    expect(states.at(-1)).toHaveLength(0);
    expect(container.querySelector('.session-row--selected')).toBeNull();
  });
});
