// Media addendum items 5–7 (2026-11-26), as the shared row renders them:
// caller-supplied menu entries (one table), "On <screen>" instead of ▶, and
// a spinner on the pressed ▶ alone.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ResultRow } from "./ResultRow.jsx";

const leaf = { id: 'plex:1', title: 'Hospital', type: 'movie' };
const renderRow = (ui) => render(<MantineProvider>{ui}</MantineProvider>);

describe('ResultRow with a caller menu table (item 7)', () => {
  it('renders exactly the entries given, in order, and fires their kinds', async () => {
    const onAction = vi.fn();
    const menu = [
      { kind: 'openScreen', label: 'Open Office Screen' },
      { kind: 'playNow', label: 'Play on Office Screen' },
      { kind: 'playNext', label: 'Play Next on Office Screen', hold: 'playFirst' },
      { divider: true },
      { kind: 'details', label: 'Open detail' },
      { kind: 'favourite', label: 'Add to favourites' },
    ];
    renderRow(<ResultRow item={leaf} onTap={() => {}} onAction={onAction} rowLabels={{ play: 'Office Screen', menu }}
      extraActions={() => [{ kind: 'watched', label: 'Mark watched' }]} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['Open Office Screen', 'Play on Office Screen', 'Play Next on Office Screen', 'Open detail', 'Add to favourites']);
    fireEvent.click(screen.getByTestId('result-action-detail-plex:1'));
    expect(onAction).toHaveBeenCalledWith({ kind: 'details', item: leaf });
  });

  it('without a table, the built-in entries are unchanged', async () => {
    renderRow(<ResultRow item={leaf} onTap={() => {}} onAction={vi.fn()} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    expect(await screen.findByRole('menuitem', { name: 'Play Now', exact: true })).toBeInTheDocument();
  });
});

describe('ResultRow already on a screen (item 5) and busy (item 6)', () => {
  it('reads "On <screen>" and pauses there instead of a fresh ▶', () => {
    const onPlayAll = vi.fn();
    const onToggle = vi.fn();
    renderRow(<ResultRow item={leaf} onTap={() => {}} onAction={vi.fn()} onPlayAll={onPlayAll}
      rowLabels={{ play: 'Office Screen', playingOn: { text: 'On Office Screen', paused: false, toggleLabel: 'Pause Hospital on Office Screen', onToggle } }} />);
    const button = screen.getByTestId('result-playing-on-plex:1');
    expect(button).toHaveTextContent('On Office Screen');
    expect(button).toHaveAccessibleName('Pause Hospital on Office Screen');
    expect(screen.queryByTestId('result-play-all-plex:1')).toBeNull();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPlayAll).not.toHaveBeenCalled();
  });

  it('the ▶ spins while its own start is in flight', () => {
    renderRow(<ResultRow item={leaf} onTap={() => {}} onAction={vi.fn()} onPlayAll={vi.fn()} rowLabels={{ play: 'Office Screen', playBusy: true }} />);
    expect(screen.getByTestId('result-play-all-plex:1')).toHaveAttribute('data-busy', 'true');
    expect(screen.getByTestId('result-row-plex:1')).not.toBeDisabled();
  });
});

describe('ResultRow menu: entries flagged `more` wait behind More (smart long lists)', () => {
  it('shows the unflagged entries, then More (k) not counting dividers; More opens the rest and reports', async () => {
    const onMenuMore = vi.fn();
    const menu = [
      { kind: 'playNow', label: 'Play Now' },
      { kind: 'playOn', label: 'Play on…' },
      { kind: 'playFirst', label: 'Play First', more: true },
      { divider: true, more: true },
      { kind: 'details', label: 'Open detail', more: true },
    ];
    renderRow(<ResultRow item={leaf} onTap={() => {}} onAction={vi.fn()} rowLabels={{ play: 'Play', menu, onMenuMore }} />);
    fireEvent.click(screen.getByTestId('result-more-plex:1'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((el) => el.textContent)).toEqual(['Play Now', 'Play on…', 'More (2)']);
    fireEvent.click(screen.getByTestId('result-action-more-plex:1-more'));
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Play Now', 'Play on…', 'Play First', 'Open detail']);
    expect(onMenuMore).toHaveBeenCalledWith({ shown: 0, hidden: 2 });
  });
});
