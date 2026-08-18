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

// The picker read as a different product: an invented brown/gold palette, a
// third of the screen empty above the keys, hairline black keys, and the note
// given only as a letter. These lock the structural half of that fix — the
// palette and the proportions are CSS, but WHERE things sit is the DOM.
describe('NoteLauncher key anatomy', () => {
  const slots = [
    { gameId: 'a', label: 'Alpha', icon: 'game', note: 60, noteName: 'C4', sharpAfter: true },
    { gameId: 'b', label: 'Beta', icon: 'game', note: 62, noteName: 'D4', sharpAfter: false },
  ];

  it('reads card, letter, icon, title down the key face', () => {
    const { container } = render(<NoteLauncher slots={slots} />);
    const key = container.querySelector('.nl-key');
    // A leading flex spacer holds the stack clear of the black keys, so the
    // content starts after it.
    const kids = [...key.children].map((el) => el.className);
    const order = kids.join(' | ');
    // The notation and the letter it spells belong together; the icon then
    // introduces the title rather than trailing after it.
    expect(order).toMatch(/chess-staff-label.*nl-key__note.*nl-key__icon.*nl-key__label/);
  });

  it('shows the note as notation as well as a letter', () => {
    const { container } = render(<NoteLauncher slots={slots} />);
    const key = container.querySelector('.nl-key');
    // The house note card (StaffNoteLabel) — the same one every addressed
    // board draws on its rim, not a grand-staff live-input widget.
    expect(key.querySelector('.chess-staff-label')).toBeTruthy();
    expect(key.querySelector('.nl-key__note').textContent).toBe('C4');
  });

  it('still marks which keys carry a sharp', () => {
    const { container } = render(<NoteLauncher slots={slots} />);
    const keys = [...container.querySelectorAll('.nl-key')];
    expect(keys[0].classList.contains('has-sharp')).toBe(true);
    expect(keys[1].classList.contains('has-sharp')).toBe(false);
  });
});
