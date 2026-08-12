import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../PianoKiosk/PianoMidiContext.jsx', () => ({
  usePianoMidi: () => ({ connected: false, status: 'disconnected' }),
  usePianoMidiNotes: () => ({ activeNotes: new Map(), noteHistory: [] }),
}));

import { PianoChessGame } from './PianoChessGame.jsx';

const sourceOutlines = (container) => container.querySelectorAll('.chess-board__square--source').length;

describe('PianoChessGame chrome', () => {
  it('has no header of its own — the kiosk breadcrumb rail names the screen', () => {
    const { container } = render(<PianoChessGame onDeactivate={() => {}} />);
    expect(container.querySelector('.piano-chess__header')).toBeNull();
    expect(container.querySelector('.piano-chess__wordmark')).toBeNull();
  });

  it('carries the way back in the shared context rail instead of a Leave button', () => {
    const onDeactivate = vi.fn();
    const { container } = render(<PianoChessGame onDeactivate={onDeactivate} />);
    const rail = container.querySelector('.psc-rail');
    expect(rail).not.toBeNull();
    expect(rail.textContent).toContain('Games');
    expect(rail.textContent).toContain('Piano Chess');
    screen.getByText('▸ Games').click();
    expect(onDeactivate).toHaveBeenCalled();
  });
});

describe('PianoChessGame legality cues', () => {
  it('does not outline the movable pieces before the player has got anything wrong', () => {
    const { container } = render(<PianoChessGame />);
    expect(container.querySelectorAll('.chess-board__square').length).toBe(64);
    expect(sourceOutlines(container)).toBe(0);
  });

  it('stays quiet even with the source cue explicitly enabled — the cue is gated on a refusal, not on config', () => {
    const { container } = render(<PianoChessGame feedback={{ highlightSources: true }} />);
    expect(sourceOutlines(container)).toBe(0);
  });
});
