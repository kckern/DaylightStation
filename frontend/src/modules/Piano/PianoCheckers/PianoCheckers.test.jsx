import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

// Same pattern as PianoConnectFour.test.jsx / PianoChessGame.test.jsx: mock the
// API client so the component never touches the network in a unit test.
vi.mock('./checkersApi.js', () => ({
  default: {
    readConfig: vi.fn(async () => null),
    readLadder: vi.fn(async () => null),
    requestMove: vi.fn(),
    saveGame: vi.fn(async () => null),
    archiveGame: vi.fn(async () => null),
    writeConfig: vi.fn(async () => null),
  },
}));

import PianoCheckers from './PianoCheckers.jsx';

describe('PianoCheckers address rail', () => {
  it('renders a file rail above the board and a rank rail beside it, both full', () => {
    const { container } = render(<PianoCheckers activeNotes={new Map()} />);
    const fileRail = container.querySelector('.checkers-stage .address-rail--horizontal');
    expect(fileRail).toBeTruthy();
    expect(fileRail.querySelectorAll('.address-rail__card')).toHaveLength(8);

    const rankRail = container.querySelector('.checkers-stage .address-rail--vertical');
    expect(rankRail).toBeTruthy();
    expect(rankRail.querySelectorAll('.address-rail__card')).toHaveLength(8);
  });

  it('never prints an address on a playable cell — cells carry pieces only', () => {
    const { container } = render(<PianoCheckers activeNotes={new Map()} />);
    expect(container.querySelector('.checkers-board__address')).toBeFalsy();
  });
});
