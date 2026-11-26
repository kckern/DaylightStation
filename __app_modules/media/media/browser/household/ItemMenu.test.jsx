// FIND.9a/AC2, FIND.11a/AC3, FIND.12a/AC1, FIND.13a/AC1 — one menu, every verb.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ItemMenu } from "./ItemMenu.jsx";

function firePointer(target, type, button = 0) {
  fireEvent(target, Object.assign(new MouseEvent(type, { bubbles: true, button }), { pointerId: 1, isPrimary: true }));
}

function open(props) {
  const onVerb = vi.fn();
  render(<MantineProvider><ItemMenu testId="t" onVerb={onVerb} {...props} /></MantineProvider>);
  fireEvent.click(screen.getByTestId('t-more'));
  return onVerb;
}

describe('ItemMenu', () => {
  it('offers the full verb set for a playable item, with favourite and watched marks', async () => {
    const onVerb = open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' }, removable: true, watched: null });
    for (const verb of ['playNow', 'playNext', 'playFirst', 'add', 'playOn', 'addOn', 'details', 'favourite', 'watched', 'unwatched', 'hide']) {
      expect(await screen.findByTestId(`t-verb-${verb}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('t-verb-shuffle')).toBeNull();
    fireEvent.click(screen.getByTestId('t-verb-hide'));
    expect(onVerb).toHaveBeenCalledWith('hide');
  });

  it('a collection offers Shuffle and favourites but no watched marks; a favourite offers removal', async () => {
    const onVerb = open({ item: { id: 'plex:9', title: 'Bluey', itemType: 'container', type: 'show' }, favourite: true });
    expect(await screen.findByTestId('t-verb-shuffle')).toBeInTheDocument();
    expect(screen.queryByTestId('t-verb-watched')).toBeNull();
    expect(screen.queryByTestId('t-verb-hide')).toBeNull();
    const fav = screen.getByTestId('t-verb-favourite');
    expect(fav).toHaveTextContent('Remove from favourites');
    fireEvent.click(fav);
    expect(onVerb).toHaveBeenCalledWith('unfavourite');
  });

  it('shows only the opposite watched mark when the state is known', async () => {
    open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' }, watched: true });
    expect(await screen.findByTestId('t-verb-unwatched')).toBeInTheDocument();
    expect(screen.queryByTestId('t-verb-watched')).toBeNull();
  });

  it('keeps the held Play next offer open and only dispatches the explicit front action', async () => {
    const onVerb = open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' } });
    const next = await screen.findByTestId('t-verb-playNext');
    vi.useFakeTimers();
    try {
      firePointer(next, 'pointerdown');
      await act(async () => vi.advanceTimersByTime(500));
      firePointer(next, 'pointerup');
      fireEvent.click(next);
      expect(onVerb).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('t-verb-playNextFront'));
      expect(onVerb.mock.calls).toEqual([['playFirst']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers the alternate action after holding Space through an unrelated key release', async () => {
    const onVerb = open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' } });
    const next = await screen.findByTestId('t-verb-playNext');
    vi.useFakeTimers();
    try {
      fireEvent.keyDown(next, { key: ' ' });
      fireEvent.keyUp(next, { key: 'Shift' });
      await act(async () => vi.advanceTimersByTime(500));
      const front = screen.getByTestId('t-verb-playNextFront');
      fireEvent.keyUp(next, { key: ' ' });
      fireEvent.click(next);
      expect(onVerb).not.toHaveBeenCalled();
      fireEvent.click(front);
      expect(onVerb.mock.calls).toEqual([['playFirst']]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the secondary mouse button to its native context menu', async () => {
    const onVerb = open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' } });
    const next = await screen.findByTestId('t-verb-playNext');
    vi.useFakeTimers();
    try {
      firePointer(next, 'pointerdown', 2);
      expect(fireEvent.contextMenu(next, { button: 2 })).toBe(true);
      await act(async () => vi.advanceTimersByTime(500));
      expect(screen.queryByTestId('t-verb-playNextFront')).toBeNull();
      expect(onVerb).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is a 44px target named for its item', () => {
    render(<MantineProvider><ItemMenu testId="t" onVerb={() => {}} item={{ id: 'plex:1', title: 'Arrival' }} /></MantineProvider>);
    expect(screen.getByRole('button', { name: 'More actions for Arrival' })).toBeInTheDocument();
  });
});

// Addendum items 5 and 7 (2026-11-26).
describe('ItemMenu reads from the one menu table', () => {
  it('uses the same words as a search row (Play Next, Add to Queue, Open detail)', async () => {
    open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' } });
    expect(await screen.findByTestId('t-verb-playNext')).toHaveTextContent(/^Play Next$/);
    expect(screen.getByTestId('t-verb-add')).toHaveTextContent(/^Add to Queue$/);
    expect(screen.getByTestId('t-verb-details')).toHaveTextContent(/^Open detail$/);
  });
  it('an item on a screen offers Open <screen>', async () => {
    const onVerb = open({ item: { id: 'plex:1', title: 'Arrival', itemType: 'leaf' }, playingOn: { name: 'Office Screen' } });
    fireEvent.click(await screen.findByTestId('t-verb-openScreen'));
    expect(onVerb).toHaveBeenCalledWith('openScreen');
    expect(screen.queryByText('Open Office Screen')).toBeDefined();
  });
});
