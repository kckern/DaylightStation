import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { UnsavedGuardProvider, useUnsavedGuardRegistry } from '../shared/UnsavedGuardContext.jsx';

vi.mock('../../../lib/api.mjs', () => ({
  DaylightAPI: vi.fn().mockResolvedValue({
    member: {
      username: 'test-user',
      display_name: 'Test User',
    },
    authStatus: null,
  }),
}));

vi.mock('../../../hooks/admin/useAdminHousehold', () => ({
  useAdminHousehold: () => ({ generateInvite: vi.fn() }),
}));

import MemberEditor from './MemberEditor.jsx';

function RegistryGrabber({ onGrab }) {
  const registry = useUnsavedGuardRegistry();
  onGrab(registry);
  return null;
}

function renderEditor(onGrabRegistry = () => {}) {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/admin/household/members/test-user']}>
        <UnsavedGuardProvider>
          <RegistryGrabber onGrab={onGrabRegistry} />
          <Routes>
            <Route path="/admin/household/members/:username" element={<MemberEditor />} />
          </Routes>
        </UnsavedGuardProvider>
      </MemoryRouter>
    </MantineProvider>
  );
}

afterEach(() => cleanup());

describe('MemberEditor — shared save chrome + unsaved guard', () => {
  it('renders the shared SaveBar with no Unsaved badge while clean', async () => {
    renderEditor();
    expect(await screen.findByTestId('config-save-button')).toBeTruthy();
    expect(screen.queryByText('Unsaved')).toBeNull();
  });

  it('shows the Unsaved badge and registers dirty with the guard after an edit', async () => {
    let registry;
    renderEditor((r) => { registry = r; });

    const nameInput = await screen.findByLabelText('Display Name');
    expect(registry.isAnyDirty()).toBe(false);

    fireEvent.change(nameInput, { target: { value: 'Renamed User' } });

    expect(screen.getByText('Unsaved')).toBeTruthy();
    expect(registry.isAnyDirty()).toBe(true);
  });

  it('revert clears the dirty state and the guard registration', async () => {
    let registry;
    renderEditor((r) => { registry = r; });

    const nameInput = await screen.findByLabelText('Display Name');
    fireEvent.change(nameInput, { target: { value: 'Renamed User' } });
    expect(registry.isAnyDirty()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /revert/i }));

    expect(screen.queryByText('Unsaved')).toBeNull();
    expect(registry.isAnyDirty()).toBe(false);
  });
});
