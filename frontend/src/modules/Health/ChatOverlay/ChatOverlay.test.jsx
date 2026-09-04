import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ChatOverlay } from './index.jsx';
import { DismissStackProvider } from '@/lib/ui';

function r(ui) { return render(<MantineProvider defaultColorScheme="dark"><DismissStackProvider>{ui}</DismissStackProvider></MantineProvider>); }

describe('ChatOverlay', () => {
  it('aria-hidden when closed', () => {
    r(<ChatOverlay open={false} onClose={vi.fn()} userId="kc">child</ChatOverlay>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('aria-hidden=false when open', () => {
    r(<ChatOverlay open={true} onClose={vi.fn()} userId="kc">child</ChatOverlay>);
    expect(screen.getByRole('dialog', { name: 'Health Coach' })).toBeInTheDocument();
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
    fireEvent.click(document.querySelector('.ds-sheet__scrim'));
    expect(onClose).toHaveBeenCalled();
  });

  it('labels the conversation', () => {
    r(<ChatOverlay open={true} onClose={vi.fn()} userId="user_1">x</ChatOverlay>);
    expect(screen.getByRole('dialog', { name: 'Health Coach' })).toBeInTheDocument();
  });
});
