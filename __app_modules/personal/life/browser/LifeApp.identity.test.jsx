import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { DaylightAPI } from '../../../../frontend/src/lib/api.mjs';
import LifeApp from './LifeApp.jsx';

vi.mock('../../../../frontend/src/lib/api.mjs', async importOriginal => ({
  ...await importOriginal(), DaylightAPI: vi.fn(),
}));
vi.mock('./hooks/useAppNotifications.js', () => ({ useAppNotifications: () => {} }));
afterEach(() => { localStorage.clear(); DaylightAPI.mockReset(); });

it.each([['beliefs', 'beliefs'], ['ceremonies', 'cadence']])(
  'holds the %s screen until the selected member resolves and retries a failed identity',
  async (route, endpoint) => {
    localStorage.setItem('life.username', 'bob');
    const member = { username: 'bob', displayName: 'Bob' };
    let rejectIdentity;
    let attempts = 0;
    const reads = [];
    DaylightAPI.mockImplementation(async path => {
      if (path === 'api/v1/life/users') return { users: [member] };
      if (path === 'api/v1/life/user?username=bob') {
        if (++attempts === 1) return new Promise((_, reject) => { rejectIdentity = reject; });
        return member;
      }
      reads.push(path);
      return endpoint === 'beliefs'
        ? { beliefs: [{ id: 'b', if_hypothesis: 'Bob marker' }] }
        : { config: { ceremonies: { unit_intention: { enabled: true, streak: 18 } } } };
    });
    render(<MemoryRouter initialEntries={['/life/plan/' + route]}><Routes>
      <Route path="/life/*" element={<LifeApp />} />
    </Routes></MemoryRouter>);
    await waitFor(() => expect(rejectIdentity).toBeTypeOf('function'));
    expect(reads).toEqual([]);
    expect(screen.queryByRole('switch')).toBeNull();
    await act(async () => rejectIdentity(new Error('Identity unavailable')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Identity unavailable');
    expect(reads).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(endpoint === 'beliefs' ? 'If Bob marker' : '18 streak')).toBeVisible();
    expect(reads).toEqual(['/api/v1/life/plan/' + endpoint + '?username=bob']);
  },
);
