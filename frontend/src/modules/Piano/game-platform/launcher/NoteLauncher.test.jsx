import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import NoteLauncher from './NoteLauncher.jsx';
import { buildLauncherSlots } from './launcherNotes.js';

const build = (n) => buildLauncherSlots(
  Array.from({ length: n }, (_, i) => ({
    id: `g${i}`, label: `Game ${i}`, icon: `game-${i}`, status: 'released',
  }))
).slots;

describe('NoteLauncher', () => {
  it('renders one key per slot', () => {
    const { container } = render(<NoteLauncher slots={build(9)} />);
    expect(container.querySelectorAll('.nl-key')).toHaveLength(9);
  });

  it('engraves the note name on each key face, in order', () => {
    const { container } = render(<NoteLauncher slots={build(9)} />);
    const names = [...container.querySelectorAll('.nl-key__note')].map(n => n.textContent);
    expect(names).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5']);
  });

  it('shows each game label', () => {
    const { getByText } = render(<NoteLauncher slots={build(3)} />);
    expect(getByText('Game 0')).toBeTruthy();
    expect(getByText('Game 2')).toBeTruthy();
  });

  it('puts a black key only where a black key belongs', () => {
    const { container } = render(<NoteLauncher slots={build(9)} />);
    const sharps = [...container.querySelectorAll('.nl-key')].map(k => k.classList.contains('has-sharp'));
    expect(sharps).toEqual([true, true, false, true, true, true, false, true, false]);
  });

  it('tells the layout how many keys to divide the row into', () => {
    const { container } = render(<NoteLauncher slots={build(6)} />);
    expect(container.querySelector('.note-launcher__keys').style.getPropertyValue('--key-count')).toBe('6');
  });

  it('does not own the hold ring — that survives the launcher closing', () => {
    // Holding the combo while the launcher is OPEN toggles it shut and then
    // force-quits at 2s. If the ring lived in here it would vanish at the
    // moment the player needs it. See HoldRing.test.jsx.
    const { container } = render(<NoteLauncher slots={build(3)} />);
    expect(container.querySelector('.nl-hold')).toBeNull();
  });

  it('is announced as a dialog', () => {
    const { getByRole } = render(<NoteLauncher slots={build(3)} />);
    expect(getByRole('dialog')).toBeTruthy();
  });
});
