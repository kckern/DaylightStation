// frontend/src/modules/Fitness/widgets/FingerprintManager/FingerprintManagerContainer.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const hook = { users: [], loading: false, refresh: vi.fn(), enroll: vi.fn(), remove: vi.fn() };
vi.mock('./useFingerprintManager.js', () => ({ useFingerprintManager: () => hook }));
vi.mock('./EnrollModal.jsx', () => ({ EnrollModal: ({ username }) => <div data-testid="enroll-modal">{username}</div> }));

import FingerprintManagerContainer from './FingerprintManagerContainer.jsx';

beforeEach(() => {
  hook.users = [
    { username: 'admin-user', displayName: 'Admin', admin: true, fingerprints: [{ finger: 'right-index', enrolled: '2026-06-17' }] },
    { username: 'new-user', displayName: 'New', admin: false, fingerprints: [] },
  ];
  hook.refresh.mockReset(); hook.enroll.mockReset(); hook.remove.mockReset();
});

describe('FingerprintManagerContainer', () => {
  it('renders each user with enrolled state on the hands', () => {
    render(<FingerprintManagerContainer />);
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('No fingerprints yet')).toBeInTheDocument();
    expect(screen.getByText('1 print enrolled')).toBeInTheDocument();
    // The admin's enrolled finger is lit on the hands (accessible label).
    expect(screen.getByLabelText('Right index — enrolled')).toBeInTheDocument();
  });

  it('Add on an UNENROLLED user opens the enroll modal directly', async () => {
    render(<FingerprintManagerContainer />);
    fireEvent.click(screen.getByRole('button', { name: /add fingerprint for new/i }));
    await waitFor(() => expect(screen.getByTestId('enroll-modal')).toHaveTextContent('new-user'));
  });

  it('tapping an empty fingertip opens enroll; tapping a lit one deletes', async () => {
    hook.remove.mockResolvedValue({ success: true });
    render(<FingerprintManagerContainer />);
    // Empty fingertip → enroll modal for that user.
    fireEvent.pointerDown(screen.getAllByLabelText('Left thumb — not enrolled')[0]);
    await waitFor(() => expect(screen.getByTestId('enroll-modal')).toBeInTheDocument());
    // Enrolled fingertip → delete by finger name.
    fireEvent.pointerDown(screen.getByLabelText('Right index — enrolled'));
    await waitFor(() => expect(hook.remove).toHaveBeenCalledWith({ username: 'admin-user', finger: 'right-index' }));
  });
});
