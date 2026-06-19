// frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

let progressCb;
vi.mock('@/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, cb) => { progressCb = cb; },
}));

import { EnrollModal } from './EnrollModal.jsx';

describe('EnrollModal', () => {
  it('shows finger options, starts enrollment, reflects scanning progress, then completes', async () => {
    // Deferred so the modal stays in the scanning phase while progress frames arrive.
    let resolveEnroll;
    const onEnroll = vi.fn(() => new Promise((r) => { resolveEnroll = r; }));
    const onDone = vi.fn();
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={onDone} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onEnroll).toHaveBeenCalledWith({ username: 'test-user', finger: 'right-index', clientToken: 'tok-1' });

    // Progress arrives DURING scanning (before enroll resolves) and advances the indicator.
    await act(async () => { progressCb({ clientToken: 'tok-1', stage: 3, stagesTotal: 5 }); });
    expect(screen.getByText(/3.*5/)).toBeInTheDocument();

    // Now the hardware finishes and onEnroll resolves → done + onDone fires.
    await act(async () => { resolveEnroll({ success: true, finger: 'right-index' }); });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ success: true, finger: 'right-index' }));
    // The "Stage N of M" line must NOT linger on the done screen.
    expect(screen.queryByText(/3.*5/)).not.toBeInTheDocument();
  });

  it('ignores progress frames for a different clientToken', async () => {
    const onEnroll = vi.fn(() => new Promise(() => {})); // never resolves — stays scanning
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    await act(async () => { progressCb({ clientToken: 'other', stage: 4, stagesTotal: 5 }); });
    expect(screen.queryByText(/4.*5/)).not.toBeInTheDocument();
  });

  it('on FAILURE stays open with a retry — does NOT close (the disappearing-menu bug)', async () => {
    const onEnroll = vi.fn().mockResolvedValue({ success: false, error: 'auth-denied' });
    const onDone = vi.fn();
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={onDone} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    // Error message shown, a Try again button offered, and onDone NOT called.
    expect(await screen.findByText(/couldn’t verify/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    // Retry returns to the picker so the operator can scan again.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });
});
