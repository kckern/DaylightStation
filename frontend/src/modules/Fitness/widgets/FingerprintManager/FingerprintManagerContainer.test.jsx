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
  it('renders each user with admin flag and fingers', () => {
    render(<FingerprintManagerContainer />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText(/right-index/)).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText(/no prints/i)).toBeInTheDocument();
  });

  it('Add on an UNENROLLED user opens the enroll modal directly (no auth screen)', async () => {
    render(<FingerprintManagerContainer />);
    fireEvent.click(screen.getByRole('button', { name: /add.*new/i }));
    await waitFor(() => expect(screen.getByTestId('enroll-modal')).toHaveTextContent('new-user'));
  });
});
