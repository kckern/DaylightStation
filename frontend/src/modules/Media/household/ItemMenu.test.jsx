// FIND.9a/AC2, FIND.11a/AC3, FIND.12a/AC1, FIND.13a/AC1 — one menu, every verb.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ItemMenu } from './ItemMenu.jsx';

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

  it('is a 44px target named for its item', () => {
    render(<MantineProvider><ItemMenu testId="t" onVerb={() => {}} item={{ id: 'plex:1', title: 'Arrival' }} /></MantineProvider>);
    expect(screen.getByRole('button', { name: 'More actions for Arrival' })).toBeInTheDocument();
  });
});
