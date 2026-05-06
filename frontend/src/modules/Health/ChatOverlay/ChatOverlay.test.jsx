import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ChatOverlay } from './index.jsx';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark">{ui}</MantineProvider>); }

describe('ChatOverlay', () => {
  it('aria-hidden when closed', () => {
    r(<ChatOverlay open={false} onClose={vi.fn()} userId="kc">child</ChatOverlay>);
    const el = document.querySelector('.chat-overlay');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  it('aria-hidden=false when open', () => {
    r(<ChatOverlay open={true} onClose={vi.fn()} userId="kc">child</ChatOverlay>);
    const el = document.querySelector('.chat-overlay');
    expect(el.getAttribute('aria-hidden')).toBe('false');
  });

  it('Esc closes', () => {
    const onClose = vi.fn();
    r(<ChatOverlay open={true} onClose={onClose} userId="kc">child</ChatOverlay>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('scrim click closes', () => {
    const onClose = vi.fn();
    r(<ChatOverlay open={true} onClose={onClose} userId="kc">child</ChatOverlay>);
    fireEvent.click(document.querySelector('.chat-overlay__scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders userId in header', () => {
    r(<ChatOverlay open={true} onClose={vi.fn()} userId="kckern">x</ChatOverlay>);
    expect(screen.getByText(/kckern/)).toBeInTheDocument();
  });
});
