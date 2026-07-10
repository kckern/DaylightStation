import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { UnsavedGuardProvider, useUnsavedGuardRegistry } from './UnsavedGuardContext.jsx';
import { useUnsavedGuard } from './useUnsavedGuard.js';

// Mock useNavigate but keep the rest of react-router-dom real (MemoryRouter, NavLink, ...)
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Imported AFTER the mock so AdminNav picks up the mocked useNavigate.
import AdminNav from '../AdminNav.jsx';

/** Consumer that registers a dirty flag via the hook. */
function GuardConsumer({ dirty, label }) {
  useUnsavedGuard(dirty, { label });
  return null;
}

/** Captures the registry context value for direct assertions. */
function RegistryGrabber({ onGrab }) {
  const registry = useUnsavedGuardRegistry();
  onGrab(registry);
  return null;
}

function renderWithProviders(ui) {
  return render(
    <MantineProvider>
      <UnsavedGuardProvider>{ui}</UnsavedGuardProvider>
    </MantineProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockNavigate.mockReset();
});

describe('useUnsavedGuard — beforeunload lifecycle', () => {
  it('does not attach a beforeunload listener while clean', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderWithProviders(<GuardConsumer dirty={false} />);
    const calls = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(calls).toHaveLength(0);
  });

  it('attaches a beforeunload listener while dirty and detaches when dirty goes false', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { rerender } = render(
      <MantineProvider>
        <UnsavedGuardProvider>
          <GuardConsumer dirty={true} />
        </UnsavedGuardProvider>
      </MantineProvider>
    );

    const added = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(added).toHaveLength(1);
    const handler = added[0][1];

    // Handler follows the beforeunload spec: preventDefault + returnValue
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    handler(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).not.toBeUndefined();

    rerender(
      <MantineProvider>
        <UnsavedGuardProvider>
          <GuardConsumer dirty={false} />
        </UnsavedGuardProvider>
      </MantineProvider>
    );

    const removed = removeSpy.mock.calls.filter(
      ([type, fn]) => type === 'beforeunload' && fn === handler
    );
    expect(removed).toHaveLength(1);
  });

  it('detaches the beforeunload listener on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderWithProviders(<GuardConsumer dirty={true} />);
    const added = addSpy.mock.calls.filter(([type]) => type === 'beforeunload');
    expect(added).toHaveLength(1);
    const handler = added[0][1];

    unmount();

    const removed = removeSpy.mock.calls.filter(
      ([type, fn]) => type === 'beforeunload' && fn === handler
    );
    expect(removed).toHaveLength(1);
  });

  it('does not crash when used outside the provider', () => {
    expect(() => {
      render(
        <MantineProvider>
          <GuardConsumer dirty={true} />
        </MantineProvider>
      );
    }).not.toThrow();
  });
});

describe('UnsavedGuardContext — dirty registry', () => {
  it('isAnyDirty reflects two consumers: one dirty makes it true, all clean makes it false', () => {
    let registry;
    const { rerender } = render(
      <MantineProvider>
        <UnsavedGuardProvider>
          <GuardConsumer dirty={true} label="a" />
          <GuardConsumer dirty={false} label="b" />
          <RegistryGrabber onGrab={(r) => { registry = r; }} />
        </UnsavedGuardProvider>
      </MantineProvider>
    );
    expect(registry.isAnyDirty()).toBe(true);

    rerender(
      <MantineProvider>
        <UnsavedGuardProvider>
          <GuardConsumer dirty={false} label="a" />
          <GuardConsumer dirty={false} label="b" />
          <RegistryGrabber onGrab={(r) => { registry = r; }} />
        </UnsavedGuardProvider>
      </MantineProvider>
    );
    expect(registry.isAnyDirty()).toBe(false);
  });

  it('a dirty consumer that unmounts is removed from the registry', () => {
    let registry;
    const { rerender } = render(
      <MantineProvider>
        <UnsavedGuardProvider>
          <GuardConsumer dirty={true} label="doomed" />
          <RegistryGrabber onGrab={(r) => { registry = r; }} />
        </UnsavedGuardProvider>
      </MantineProvider>
    );
    expect(registry.isAnyDirty()).toBe(true);

    rerender(
      <MantineProvider>
        <UnsavedGuardProvider>
          <RegistryGrabber onGrab={(r) => { registry = r; }} />
        </UnsavedGuardProvider>
      </MantineProvider>
    );
    expect(registry.isAnyDirty()).toBe(false);
  });
});

describe('AdminNav — navigation interception', () => {
  function renderNav({ dirty }) {
    return render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/admin/system/config']}>
          <UnsavedGuardProvider>
            <GuardConsumer dirty={dirty} label="editor" />
            <AdminNav />
          </UnsavedGuardProvider>
        </MemoryRouter>
      </MantineProvider>
    );
  }

  it('blocks nav-link clicks while dirty and shows the discard modal', async () => {
    renderNav({ dirty: true });

    fireEvent.click(screen.getByText('Menus'));

    expect(await screen.findByText(/discard unsaved changes/i)).toBeTruthy();
    expect(screen.getByText(/your edits will be lost/i)).toBeTruthy();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('confirming the modal navigates to the intercepted destination', async () => {
    renderNav({ dirty: true });

    fireEvent.click(screen.getByText('Menus'));
    await screen.findByText(/discard unsaved changes/i);

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/admin/content/lists/menus');
  });

  it('does not intercept when nothing is dirty', () => {
    renderNav({ dirty: false });

    fireEvent.click(screen.getByText('Menus'));

    expect(screen.queryByText(/discard unsaved changes/i)).toBeNull();
  });
});
