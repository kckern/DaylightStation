import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SelectBanner from './SelectBanner.jsx';

describe('SelectBanner', () => {
  it('renders nothing when no edge is armed', () => {
    const { container } = render(<SelectBanner onCancel={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('asks for the loop START when the in edge is armed', () => {
    render(<SelectBanner edge="in" onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/loop start/i);
  });

  it('asks for the loop END when the out edge is armed', () => {
    render(<SelectBanner edge="out" onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/loop end/i);
  });

  it('says to tap inside the music when a tap landed in a dead margin', () => {
    // There is no near-a-note rule any more (wave-3 F) — only a tap outside every
    // system's band is rejected, so the copy names the band, not a note.
    render(<SelectBanner edge="in" rejects={1} onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/inside the music/i);
    expect(screen.getByRole('status').className).toMatch(/is-reject/);
  });

  it('reverts to the instruction when no rejection has happened', () => {
    render(<SelectBanner edge="in" rejects={0} onCancel={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/loop start/i);
    expect(screen.getByRole('status').className).not.toMatch(/is-reject/);
  });

  // `rejects` is a counter, not a boolean: the banner is re-KEYED on it so the
  // shake animation restarts for every rejected tap (a second miss must be as
  // visible as the first — audit H4a). A remount is what restarts a CSS
  // animation, so the node identity has to change.
  it('remounts on each rejection so the shake replays', () => {
    const { rerender } = render(<SelectBanner edge="in" rejects={1} onCancel={() => {}} />);
    const first = screen.getByRole('status');
    rerender(<SelectBanner edge="in" rejects={2} onCancel={() => {}} />);
    expect(screen.getByRole('status')).not.toBe(first);
  });

  it('offers Cancel', () => {
    const onCancel = vi.fn();
    render(<SelectBanner edge="out" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
