import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { NavProvider, useNav } from './NavProvider.jsx';

function Probe() {
  const nav = useNav();
  return <output
    data-testid="nav-probe"
    data-view={nav.view}
    data-depth={nav.depth}
    data-area={nav.area}
    data-back-destination={nav.backDestination ?? ''}
    ref={(node) => { if (node) node.nav = nav; }}
  />;
}

function probe() {
  return screen.getByTestId('nav-probe');
}

function nav() {
  return probe().nav;
}

beforeEach(() => {
  window.history.replaceState(null, '', '/media');
});

describe('NavProvider area and browser-history contract', () => {
  it('maps every nested media surface to its primary area', () => {
    render(<NavProvider><Probe /></NavProvider>);
    expect(probe()).toHaveAttribute('data-area', 'home');

    act(() => nav().push('detail', { contentId: 'plex:arrival' }));
    expect(probe()).toHaveAttribute('data-area', 'browse');

    act(() => nav().push('nowPlaying'));
    expect(probe()).toHaveAttribute('data-area', 'home');

    act(() => nav().push('peek', { deviceId: 'tv-1' }));
    expect(probe()).toHaveAttribute('data-area', 'fleet');
  });

  it('reselecting Browse returns to its top without another Back stop', async () => {
    render(<NavProvider><Probe /></NavProvider>);
    act(() => nav().push('browse', { path: '' }));
    act(() => nav().push('detail', { contentId: 'plex:arrival' }));
    const before = window.history.length;
    const nativeGo = window.history.go.bind(window.history);
    let lengthAtTraversal = null;
    window.history.go = (delta) => {
      lengthAtTraversal = window.history.length;
      return nativeGo(delta);
    };

    try { act(() => nav().goToArea('browse')); } finally { window.history.go = nativeGo; }

    await waitFor(() => expect(probe()).toHaveAttribute('data-view', 'browse'));
    expect(location.search).toBe('?view=browse');
    expect(window.history.state.mediaNavStack.at(-1)).toMatchObject({ view: 'browse', params: { path: '' } });
    // Happy DOM discards the forward entry after traversal; real browsers do
    // not. Capture the value at the synchronous browser traversal seam, then
    // prove the ensuing route transition separately below.
    expect(lengthAtTraversal).toBe(before);

    act(() => window.history.back());
    await waitFor(() => expect(probe()).toHaveAttribute('data-view', 'home'));
  });

  it('keeps the rendered route coherent with the current history entry until traversal pops', () => {
    render(<NavProvider><Probe /></NavProvider>);
    act(() => nav().push('browse', { path: '' }));
    act(() => nav().push('detail', { contentId: 'plex:arrival' }));
    const historyGo = vi.spyOn(window.history, 'go').mockImplementation(() => {});

    act(() => nav().goToArea('browse'));

    expect(historyGo).toHaveBeenCalledWith(-1);
    expect(probe()).toHaveAttribute('data-view', 'detail');
    expect(location.search).toContain('view=detail');
    expect(window.history.state.mediaNavStack.at(-1)).toMatchObject({ view: 'detail' });
    historyGo.mockRestore();
  });

  it.each([
    ['Home', 'browse', { path: '' }, 'Home'],
    ['Browse', 'detail', { contentId: 'plex:arrival' }, 'Browse'],
    ['Devices', 'nowPlaying', {}, 'Devices'],
  ])('names %s as the actual prior area', (origin, destination, params, label) => {
    render(<NavProvider><Probe /></NavProvider>);
    if (origin === 'Browse') act(() => nav().push('browse', { path: '' }));
    if (origin === 'Devices') act(() => nav().push('fleet'));
    act(() => nav().push(destination, params));
    expect(probe()).toHaveAttribute('data-back-destination', label);
  });

  it('falls back from a depth-one detail link to Home without leaving media', () => {
    window.history.replaceState(null, '', '/media?view=detail&contentId=plex:arrival');
    render(<NavProvider><Probe /></NavProvider>);

    act(() => nav().pop());

    expect(probe()).toHaveAttribute('data-view', 'home');
    expect(location.pathname).toBe('/media');
    expect(location.search).toBe('');
  });

  it('normalizes an unknown view URL to canonical Home state and URL', () => {
    window.history.replaceState(null, '', '/media?view=nope');
    render(<NavProvider><Probe /></NavProvider>);

    expect(probe()).toHaveAttribute('data-view', 'home');
    expect(probe()).toHaveAttribute('data-area', 'home');
    expect(location.pathname).toBe('/media');
    expect(location.search).toBe('');
  });
});
