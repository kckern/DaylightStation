import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import DetailModal from './DetailModal.jsx';

vi.mock('./DetailView.jsx', () => ({
  default: () => <><button>First action</button><button>Last action</button></>,
}));

describe('DetailModal', () => {
  test('provides dialog semantics, Escape close, and a contained Tab cycle', () => {
    const onBack = vi.fn();
    render(<DetailModal item={{ title: 'Story detail' }} sections={[]} onBack={onBack} />);

    const dialog = screen.getByRole('dialog', { name: 'Story detail' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledOnce();
  });
});
