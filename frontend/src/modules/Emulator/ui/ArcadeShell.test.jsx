import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ArcadeShell } from './ArcadeShell.jsx';
import { ConsoleTabs } from './ConsoleTabs.jsx';
import { GameCover } from './GameCover.jsx';

const consoles = [
  { system: 'gb', label: 'Game Boy', placeholder: false },
  { system: null, label: null, placeholder: true },
  { system: null, label: null, placeholder: true },
];
const games = [
  { id: 'pokemon-red', system: 'gb', title: 'Pokémon Red', coverUrl: '/cover/red', saveMode: 'battery' },
  { id: 'mario-land', system: 'gb', title: 'Super Mario Land', coverUrl: '/cover/mario', saveMode: 'state' },
  { id: 'kart', system: 'snes', title: 'Mario Kart', coverUrl: '/cover/kart', saveMode: 'none' },
];

describe('ConsoleTabs', () => {
  it('renders real tabs as buttons and placeholders as inert blanks', () => {
    const { container } = render(<ConsoleTabs consoles={consoles} activeSystem="gb" onSelect={() => {}} />);
    expect(container.querySelectorAll('button.emu-console-tab').length).toBe(1);
    expect(container.querySelectorAll('.emu-console-tab--placeholder').length).toBe(2);
    expect(container.querySelector('.emu-console-tab.is-active').textContent).toBe('Game Boy');
  });

  it('fires onSelect with the system on tap', () => {
    const onSelect = vi.fn();
    const { container } = render(<ConsoleTabs consoles={consoles} activeSystem="gb" onSelect={onSelect} />);
    fireEvent.pointerDown(container.querySelector('button.emu-console-tab'));
    expect(onSelect).toHaveBeenCalledWith('gb');
  });
});

describe('GameCover', () => {
  it('renders cover art, falls back to the title on error', () => {
    const { container, rerender } = render(<GameCover game={games[0]} onActivate={() => {}} />);
    const img = container.querySelector('img.emu-cover__img');
    expect(img.getAttribute('src')).toBe('/cover/red');
    fireEvent.error(img);
    expect(container.querySelector('.emu-cover__fallback').textContent).toBe('Pokémon Red');
    // a game with no coverUrl renders the fallback immediately
    rerender(<GameCover game={{ id: 'x', title: 'No Cover' }} onActivate={() => {}} />);
    expect(container.querySelector('.emu-cover__fallback').textContent).toBe('No Cover');
  });
});

describe('ArcadeShell', () => {
  it('shows only the active console\'s games', () => {
    const { container } = render(<ArcadeShell consoles={consoles} games={games} />);
    // default active = first real console (gb) → 2 gb games, not the snes one
    const covers = container.querySelectorAll('.emu-cover');
    expect(covers.length).toBe(2);
  });

  it('launches the focused game on the select intent (Enter)', () => {
    const onSelectGame = vi.fn();
    render(<ArcadeShell consoles={consoles} games={games} onSelectGame={onSelectGame} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelectGame).toHaveBeenCalledWith(expect.objectContaining({ id: 'pokemon-red' }));
  });

  it('right intent moves focus before launching', () => {
    const onSelectGame = vi.fn();
    render(<ArcadeShell consoles={consoles} games={games} onSelectGame={onSelectGame} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onSelectGame).toHaveBeenCalledWith(expect.objectContaining({ id: 'mario-land' }));
  });

  it('back intent exits the shell', () => {
    const onExit = vi.fn();
    render(<ArcadeShell consoles={consoles} games={games} onExit={onExit} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).toHaveBeenCalled();
  });

  it('switching console tab swaps the visible games', () => {
    const { container, getByText } = render(<ArcadeShell consoles={[{ system: 'gb', label: 'Game Boy', placeholder: false }, { system: 'snes', label: 'SNES', placeholder: false }]} games={games} />);
    expect(container.querySelectorAll('.emu-cover').length).toBe(2); // gb
    fireEvent.pointerDown(getByText('SNES'));
    expect(container.querySelectorAll('.emu-cover').length).toBe(1); // snes: mario kart
  });
});
