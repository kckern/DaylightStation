import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const playTone = vi.fn();
vi.mock('./scanCeremonySound.js', () => ({
  playScanCeremonyTone: (...args) => playTone(...args),
}));

import { ScanCeremony } from './ScanCeremony.jsx';

describe('ScanCeremony', () => {
  beforeEach(() => {
    playTone.mockClear();
  });

  it('renders a role=status banner with the title and detail', () => {
    render(<ScanCeremony tone="success" title="Scored!" detail="8 of 10 right — your sheet is printing." at={1} onDismiss={vi.fn()} />);
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Scored!');
    expect(banner).toHaveTextContent('8 of 10 right — your sheet is printing.');
  });

  it('tone-colours the banner via a class per tone', () => {
    render(<ScanCeremony tone="error" title="Scanner hiccup" detail="Feed the sheet again." at={1} onDismiss={vi.fn()} />);
    expect(screen.getByTestId('scan-ceremony')).toHaveClass('school-scan-ceremony--error');
  });

  it('shows the code as secondary detail only when present', () => {
    const { rerender } = render(
      <ScanCeremony tone="error" title="Couldn't read that sheet" detail="Try again." at={1} code="CARD_ID_UNREADABLE" onDismiss={vi.fn()} />,
    );
    expect(screen.getByText('CARD_ID_UNREADABLE')).toBeInTheDocument();

    rerender(<ScanCeremony tone="success" title="Scored!" detail="Printing." at={2} onDismiss={vi.fn()} />);
    expect(screen.queryByText('CARD_ID_UNREADABLE')).not.toBeInTheDocument();
  });

  it('plays the matching tone once per ceremony (by `at`)', () => {
    const { rerender } = render(<ScanCeremony tone="warn" title="Needs a grown-up" detail="…" at={5} onDismiss={vi.fn()} />);
    expect(playTone).toHaveBeenCalledTimes(1);
    expect(playTone).toHaveBeenCalledWith('warn');

    // Re-render with the SAME `at` (e.g. a parent re-render for an unrelated
    // reason) must not re-fire the sound.
    rerender(<ScanCeremony tone="warn" title="Needs a grown-up" detail="…" at={5} onDismiss={vi.fn()} />);
    expect(playTone).toHaveBeenCalledTimes(1);

    // A genuinely new scan (new `at`) fires again.
    rerender(<ScanCeremony tone="error" title="Scanner hiccup" detail="…" at={6} onDismiss={vi.fn()} />);
    expect(playTone).toHaveBeenCalledTimes(2);
    expect(playTone).toHaveBeenLastCalledWith('error');
  });

  it('calls onDismiss when the banner is tapped', () => {
    const onDismiss = vi.fn();
    render(<ScanCeremony tone="success" title="Scored!" detail="Printing." at={1} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('scan-ceremony'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
