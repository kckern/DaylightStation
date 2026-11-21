// frontend/src/lib/ui/Sheet.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useRef, useState } from 'react';
import { MantineProvider } from '@mantine/core';
import { DismissStackProvider } from './dismiss/DismissStackProvider.jsx';
import { AppFrame } from './AppFrame.jsx';
import { Sheet } from './Sheet.jsx';
import { useOverlayScrollLock } from './useOverlayScrollLock.js';
import { useRetryRegion } from './useRetryRegion.js';

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

  it('renders title and children when open, closes on scrim click and Escape', async () => {
    const onClose = vi.fn();
    const { container } = wrap(<Sheet open onClose={onClose} title="Portion">body</Sheet>);
    expect(screen.getByText('Portion')).toBeTruthy();
    expect(screen.getByText('body')).toBeTruthy();
    fireEvent.click(container.querySelector('.ds-sheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('placement="side" marks the root; the default has no modifier', () => {
    const { container, rerender } = wrap(<Sheet open onClose={() => {}} title="T" placement="side">x</Sheet>);
    expect(container.querySelector('.ds-sheet').classList.contains('ds-sheet--side')).toBe(true);
    rerender(<MantineProvider><DismissStackProvider><Sheet open onClose={() => {}} title="T">x</Sheet></DismissStackProvider></MantineProvider>);
    expect(container.querySelector('.ds-sheet').className).toBe('ds-sheet');
  });

  it('placement="fullscreen" marks the root, for a camera view that owns the whole screen', () => {
    const { container } = wrap(<Sheet open onClose={() => {}} title="T" placement="fullscreen">x</Sheet>);
    expect(container.querySelector('.ds-sheet').className).toBe('ds-sheet ds-sheet--fullscreen');
  });

  it('locks body scroll while open and restores on unmount', () => {
    const { unmount } = wrap(<Sheet open onClose={() => {}} title="T">x</Sheet>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('hides app background from assistive technology and preserves a portaled dialog choice', async () => {
    const popupHost = document.createElement('div');
    document.body.append(popupHost);

    function AccessibleDialog() {
      const [open, setOpen] = useState(true);
      return (
        <div className="ds-root">
          <nav aria-label="Primary"><button>Fuel</button></nav>
          <main><button>Log a fill-up</button></main>
          <Sheet open={open} onClose={() => setOpen(false)} title="Log a fill-up">
            <button>Save</button>
            {createPortal(<button>Choose image</button>, popupHost)}
          </Sheet>
        </div>
      );
    }

    try {
      wrap(<AccessibleDialog />);
      const nav = document.querySelector('[aria-label="Primary"]');
      const main = document.querySelector('main');
      const dialog = screen.getByRole('dialog', { name: 'Log a fill-up' });
      expect(nav).toHaveAttribute('aria-hidden', 'true');
      expect(main).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Choose image' })).toBeInTheDocument();
      expect(dialog).not.toHaveAttribute('aria-hidden', 'true');

      fireEvent.keyDown(dialog, { key: 'Escape' });
      await waitFor(() => expect(nav).not.toHaveAttribute('aria-hidden', 'true'));
      expect(main).not.toHaveAttribute('aria-hidden', 'true');
    } finally {
      popupHost.remove();
    }
  });

  it('keeps focus in the recovery region when Retry runs during sheet opening', () => {
    function Recovery() {
      const [pending, setPending] = useState(false);
      const { regionProps, retry } = useRetryRegion(() => setPending(true), pending);
      return <Sheet open title="Task" onClose={() => {}}>
        <section {...regionProps} aria-label="Result">
          {pending ? 'Loading' : <button onClick={retry}>Retry</button>}
        </section>
      </Sheet>;
    }

    vi.useFakeTimers();
    try {
      wrap(<Recovery />);
      const retry = screen.getByRole('button', { name: 'Retry' });
      const region = screen.getByRole('region', { name: 'Result' });
      retry.focus();
      fireEvent.click(retry);
      expect(document.activeElement).toBe(region);
      expect(region.getAttribute('aria-busy')).toBe('true');
      act(() => { vi.runOnlyPendingTimers(); });
      expect(document.activeElement).toBe(region);
    } finally {
      vi.useRealTimers();
    }
  });

  it('locks only the owning frame and keeps it locked across different overlay types', () => {
    function Fullscreen({ open }) {
      useOverlayScrollLock(open);
      return null;
    }
    function Frames({ first, second }) {
      return <>
        <AppFrame>
          <Sheet open={first} title="First" onClose={() => {}}>First task</Sheet>
          <Fullscreen open={second} />
        </AppFrame>
        <AppFrame>Independent view</AppFrame>
      </>;
    }
    const view = wrap(<Frames first second />);
    const [owner, other] = screen.getAllByRole('main', { hidden: true });
    expect(owner.style.overflow).toBe('hidden');
    expect(owner).not.toHaveAttribute('aria-hidden', 'true');
    expect(other.closest('.ds-chrome')).toHaveAttribute('aria-hidden', 'true');
    expect(other.style.overflow).toBe('');
    view.rerender(<MantineProvider><DismissStackProvider>
      <Frames first={false} second />
    </DismissStackProvider></MantineProvider>);
    expect(owner.style.overflow).toBe('hidden');
    view.rerender(<MantineProvider><DismissStackProvider>
      <Frames first={false} second={false} />
    </DismissStackProvider></MantineProvider>);
    expect(owner.style.overflow).toBe('');
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

  it('returns to the current trigger when the original trigger was removed', async () => {
    function Flow() {
      const [open, setOpen] = useState(false);
      const trigger = useRef(null);
      return <>
        {open ? null : <button ref={trigger} onClick={() => setOpen(true)}>Open task</button>}
        <Sheet open={open} onClose={() => setOpen(false)} title="Task" returnFocusRef={trigger}>Task body</Sheet>
      </>;
    }
    wrap(<Flow />);
    const original = screen.getByRole('button', { name: 'Open task' });
    original.focus();
    fireEvent.click(original);
    expect(original.isConnected).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open task' })));
  });

  it('carries a fallback through a replacement when the original opener is gone', async () => {
    function Flow() {
      const [step, setStep] = useState(null);
      const fallback = useRef(null);
      return <>
        {step === 'next' ? null : <button onClick={() => setStep('entry')}>Open entry</button>}
        <button ref={fallback}>Entries</button>
        {step === 'entry' ? <Sheet open title="Entry" onClose={() => setStep(null)} getFallbackFocusTarget={() => fallback.current}>
          <button onClick={() => setStep('next')}>Open next</button>
        </Sheet> : null}
        {step === 'next' ? <Sheet open title="Next" onClose={() => setStep('done')}>Next entry</Sheet> : null}
      </>;
    }
    wrap(<Flow />);
    const opener = screen.getByRole('button', { name: 'Open entry' });
    opener.focus();
    fireEvent.click(opener);
    const next = screen.getByRole('button', { name: 'Open next' });
    next.focus();
    fireEvent.click(next);
    expect(opener.isConnected).toBe(false);
    const replacement = screen.getByRole('dialog', { name: 'Next' });
    const close = replacement.querySelector('button[aria-label="Close"]');
    await waitFor(() => expect(document.activeElement).toBe(close), { timeout: 800 });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Next' })).not.toBeInTheDocument());
    const entries = screen.getByRole('button', { name: 'Entries' });
    await waitFor(() => expect(document.activeElement).toBe(entries), { timeout: 800 });
  });

  it('uses the latest fallback target when it changes during an open visit', async () => {
    function Flow() {
      const [open, setOpen] = useState(false);
      const [fallbackChoice, setFallbackChoice] = useState('first');
      const firstFallback = useRef(null);
      const nextFallback = useRef(null);
      const getFallbackFocusTarget = () => (fallbackChoice === 'first' ? firstFallback : nextFallback).current;
      return <>
        {open ? null : <button onClick={() => setOpen(true)}>Open task</button>}
        <button ref={firstFallback}>First fallback</button>
        <button ref={nextFallback}>Next fallback</button>
        <Sheet open={open} onClose={() => setOpen(false)} title="Task" getFallbackFocusTarget={getFallbackFocusTarget}>
          <button>Keep focus here</button>
          <button onClick={() => setFallbackChoice('next')}>Use next fallback</button>
        </Sheet>
      </>;
    }
    wrap(<Flow />);
    const opener = screen.getByRole('button', { name: 'Open task' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Use next fallback' }));
    screen.getByRole('button', { name: 'Keep focus here' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Next fallback' })));
  });
});
