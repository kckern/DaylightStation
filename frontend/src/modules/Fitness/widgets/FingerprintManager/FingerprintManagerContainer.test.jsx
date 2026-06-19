// frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const hook = { users: [], loading: false, refresh: vi.fn(), enroll: vi.fn(), remove: vi.fn() };
vi.mock('./useFingerprintManager.js', () => ({ useFingerprintManager: () => hook }));
vi.mock('./EnrollModal.jsx', () => ({ EnrollModal: ({ username }) => <div data-testid="enroll-modal">{username}</div> }));

// Admin gate: mock the identity hook so registerUnlock resolves as a matched
// admin, opening the gate. Behavior of the gate itself is covered in
// IdentityProvider.test.jsx; here we just need the manager to render.
const identity = {
  registerUnlock: vi.fn(() => Promise.resolve({ matched: true, userId: 'admin-user' })),
  clearUnlock: vi.fn(),
  unlockState: 'scanning',
  unlockedUser: null,
};
vi.mock('@/modules/Fitness/identity/IdentityProvider', () => ({ useIdentity: () => identity }));

import FingerprintManagerContainer from './FingerprintManagerContainer.jsx';

beforeEach(() => {
  identity.registerUnlock.mockClear(); identity.clearUnlock.mockClear();
  hook.users = [
    { username: 'admin-user', displayName: 'Admin', admin: true, fingerprints: [{ finger: 'right-index', enrolled: '2026-06-17' }] },
    { username: 'new-user', displayName: 'New', admin: false, fingerprints: [] },
  ];
  hook.refresh.mockReset(); hook.enroll.mockReset(); hook.remove.mockReset();
});

describe('FingerprintManagerContainer', () => {
  it('requires an admin unlock before rendering the roster', async () => {
    render(<FingerprintManagerContainer />);
    // Gate scans for the admin lock; roster only appears after a matched verdict.
    expect(identity.registerUnlock).toHaveBeenCalledWith('admin');
    expect(await screen.findByText('New')).toBeInTheDocument();
    expect(screen.getByText('No fingerprints yet')).toBeInTheDocument();
    expect(screen.getByText('1 print enrolled')).toBeInTheDocument();
    // The admin's enrolled finger is lit on the hands (accessible label).
    expect(screen.getByLabelText('Right index — enrolled')).toBeInTheDocument();
  });

  it('Add on an UNENROLLED user opens the enroll modal directly', async () => {
    render(<FingerprintManagerContainer />);
    const addBtn = await screen.findByRole('button', { name: /add fingerprint for new/i });
    fireEvent.click(addBtn);
    await waitFor(() => expect(screen.getByTestId('enroll-modal')).toHaveTextContent('new-user'));
  });

  it('tapping an empty fingertip opens enroll for that user', async () => {
    render(<FingerprintManagerContainer />);
    const emptyTip = (await screen.findAllByLabelText('Left thumb — not enrolled'))[0];
    fireEvent.pointerDown(emptyTip);
    await waitFor(() => expect(screen.getByTestId('enroll-modal')).toBeInTheDocument());
  });

  it('tapping a lit fingertip confirms first, then deletes only on Remove', async () => {
    hook.remove.mockResolvedValue({ success: true });
    render(<FingerprintManagerContainer />);
    fireEvent.pointerDown(await screen.findByLabelText('Right index — enrolled'));
    // Confirmation shown; nothing deleted yet (no instant-delete on tap).
    expect(await screen.findByText('Remove fingerprint')).toBeInTheDocument();
    expect(hook.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    await waitFor(() => expect(hook.remove).toHaveBeenCalledWith({ username: 'admin-user', finger: 'right-index' }));
  });
});
