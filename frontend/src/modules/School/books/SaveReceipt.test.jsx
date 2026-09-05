import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SaveReceipt, { receiptCopy } from './SaveReceipt.jsx';

const BOOK = { title: 'The Wild Robot', authors: ['Peter Brown'], coverUrl: '/cover.jpg' };

describe('SaveReceipt', () => {
  it('makes a finished write explicit and offers History', () => {
    const onBack = vi.fn();
    const onHistory = vi.fn();
    const onUndo = vi.fn();
    render(<SaveReceipt receipt={{ kind: 'finished', book: BOOK, finishedOn: '2026-09-03' }} onBack={onBack} onHistory={onHistory} onUndo={onUndo} />);
    expect(screen.getByRole('status')).toHaveTextContent('Book finished!');
    expect(screen.getByRole('status')).toHaveTextContent('Saved in History · Sep 3');
    expect(screen.getByRole('img', { name: 'Cover of The Wild Robot' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See History' }));
    expect(onHistory).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to my books' }));
    expect(onBack).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Undo finish' }));
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it('does not offer History for an ordinary progress save', () => {
    render(<SaveReceipt receipt={{ kind: 'progress', book: BOOK, page: 84 }} onBack={() => {}} onHistory={() => {}} />);
    expect(screen.getByText('Page 84 is on your shelf.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See History' })).toBeNull();
    expect(receiptCopy({ kind: 'checkin' }).heading).toBe('Reading logged');
  });

  it('names an append-only finish correction and freezes actions while saving', () => {
    const onBack = vi.fn();
    render(<SaveReceipt receipt={{ kind: 'reopened', book: BOOK }} busy error={{ message: 'Still saving' }} onBack={onBack} />);
    expect(screen.getByRole('status')).toHaveTextContent('Finish undone');
    expect(screen.getByRole('alert')).toHaveTextContent('Still saving');
    const back = screen.getByRole('button', { name: 'Back to my books' });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('explains an edition page-count mismatch without rejecting what the child sees', () => {
    render(<SaveReceipt
      receipt={{ kind: 'progress', book: { ...BOOK, pageCount: 184 }, page: 212 }}
      onBack={() => {}}
    />);
    expect(screen.getByText(/page 212 saved/i)).toHaveTextContent(/listed as 184 pages/i);
  });
});
