// frontend/src/lib/ui/Sheet.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
import { Sheet } from './Sheet.jsx';

// Sheet uses Mantine's ActionIcon, which throws without a MantineProvider in
// the tree (see states.test.jsx for the same pattern).
const wrap = (ui) => render(
  <MantineProvider><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>,
);

describe('Sheet', () => {
  it('renders nothing when closed', () => {
    const { container } = wrap(<Sheet open={false} onClose={() => {}} title="T">x</Sheet>);
    expect(container.querySelector('.ds-sheet')).toBeNull();
  });

  it('renders title and children when open, closes on scrim click and Escape', () => {
    const onClose = vi.fn();
    const { container } = wrap(<Sheet open onClose={onClose} title="Portion">body</Sheet>);
    expect(screen.getByText('Portion')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(container.querySelector('.ds-sheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('locks body scroll while open and restores on unmount', () => {
    const { unmount } = wrap(<Sheet open onClose={() => {}} title="T">x</Sheet>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('returns focus to the original opener after replacing a dialog', async () => {
    function Flow() {
      const [step, setStep] = useState(null);
      return <>
        <button onClick={() => setStep('entry')}>Open entry</button>
        {step === 'entry' ? <Sheet open title="Entry" onClose={() => setStep(null)}>
          <button onClick={() => setStep('coach')}>Ask coach</button>
        </Sheet> : null}
        {step === 'coach' ? <Sheet open title="Coach" onClose={() => setStep(null)}>
          <input aria-label="Message" />
        </Sheet> : null}
      </>;
    }
    wrap(<Flow />);
    const opener = screen.getByText('Open entry');
    opener.focus(); fireEvent.click(opener);
    const next = screen.getByText('Ask coach');
    next.focus(); fireEvent.click(next);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.body.style.overflow).toBe('');
  });
});
