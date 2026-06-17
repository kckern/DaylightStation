// frontend/src/modules/Fitness/widgets/FingerprintManager/EnrollModal.test.jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

let progressCb;
vi.mock('@/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_filter, cb) => { progressCb = cb; },
}));

import { EnrollModal } from './EnrollModal.jsx';

describe('EnrollModal', () => {
  it('shows finger options and starts enrollment, then reflects progress', async () => {
    const onEnroll = vi.fn().mockResolvedValue({ success: true, finger: 'right-index' });
    const onDone = vi.fn();
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={onDone} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onEnroll).toHaveBeenCalledWith({ username: 'test-user', finger: 'right-index', clientToken: 'tok-1' });

    await act(async () => { progressCb({ clientToken: 'tok-1', stage: 3, stagesTotal: 5 }); });
    expect(screen.getByText(/3.*5/)).toBeInTheDocument();

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ success: true, finger: 'right-index' }));
  });

  it('ignores progress frames for a different clientToken', async () => {
    const onEnroll = vi.fn().mockResolvedValue({ success: true });
    render(<EnrollModal username="test-user" clientToken="tok-1" onEnroll={onEnroll} onDone={() => {}} onCancel={() => {}} />);
    await act(async () => { progressCb({ clientToken: 'other', stage: 4, stagesTotal: 5 }); });
    expect(screen.queryByText(/4.*5/)).not.toBeInTheDocument();
  });
});
