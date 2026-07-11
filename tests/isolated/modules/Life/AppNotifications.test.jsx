// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

// Mock the shared WS client at the module boundary. The hook imports it via a
// relative path but it resolves to the same module the alias points at, so the
// mock applies. We capture the subscription callback so the test can emit a
// fake 'notification' frame — this is cleaner than standing up a real socket,
// and it exercises the exact envelope wsService would dispatch.
const wsHolder = vi.hoisted(() => ({ handler: null, filter: null }));
vi.mock('#frontend/hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (filter, cb) => {
    wsHolder.filter = filter;
    wsHolder.handler = cb;
  },
}));

import { useAppNotifications } from '#frontend/modules/Life/hooks/useAppNotifications.js';

/** Exposes the current path so an actionable-toast navigation can be asserted. */
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
};

/** Drives the hook with the router's navigate, like LifeApp does. */
const HookRunner = ({ username }) => {
  const navigate = useNavigate();
  useAppNotifications({ username, navigate });
  return null;
};

const renderHarness = (username = 'test-user') => render(
  <MantineProvider>
    <MemoryRouter initialEntries={['/life/now']}>
      <Notifications />
      <HookRunner username={username} />
      <LocationProbe />
    </MemoryRouter>
  </MantineProvider>
);

/** Build a broadcast frame exactly as WebSocketEventBus frames it: topic + intentJSON. */
const frame = (overrides = {}) => ({
  topic: 'notification',
  timestamp: Date.now(),
  title: 'Ceremony time',
  body: 'Your weekly review is ready',
  category: 'ceremony',
  urgency: 'normal',
  actions: [],
  metadata: {},
  createdAt: new Date().toISOString(),
  ...overrides,
});

const emit = (f) => act(() => { wsHolder.handler?.(f); });

beforeEach(() => {
  wsHolder.handler = null;
  notifications.clean();
});
afterEach(() => {
  notifications.clean();
});

describe('useAppNotifications', () => {
  it('subscribes to the shared WS "notification" topic', () => {
    renderHarness();
    expect(wsHolder.filter).toBe('notification');
    expect(typeof wsHolder.handler).toBe('function');
  });

  it('renders a toast with the intent title and body', async () => {
    renderHarness('test-user');
    emit(frame());

    await waitFor(() => {
      expect(screen.getByText('Ceremony time')).toBeInTheDocument();
    });
    expect(screen.getByText('Your weekly review is ready')).toBeInTheDocument();
  });

  it('shows an unaddressed (broadcast) intent to everyone', async () => {
    renderHarness('test-user');
    emit(frame({ metadata: {} }));

    await waitFor(() => {
      expect(screen.getByText('Ceremony time')).toBeInTheDocument();
    });
  });

  it('does NOT show an intent addressed to a different user', async () => {
    renderHarness('test-user');
    emit(frame({ title: 'For someone else', metadata: { username: 'other-user' } }));

    // Give the store a tick; the toast must never appear.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('For someone else')).toBeNull();
  });

  it('shows an intent addressed to the current user', async () => {
    renderHarness('test-user');
    emit(frame({ title: 'Just for you', metadata: { username: 'test-user' } }));

    await waitFor(() => {
      expect(screen.getByText('Just for you')).toBeInTheDocument();
    });
  });

  it('renders a clickable action that navigates in-app (relative url)', async () => {
    renderHarness('test-user');
    emit(frame({
      title: 'Begin review',
      actions: [{ label: 'Open', action: 'navigate', data: { url: '/life/plan/goals' } }],
    }));

    const link = await screen.findByTestId('notification-action');
    expect(link).toHaveTextContent('Open');

    fireEvent.click(link);
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/life/plan/goals');
  });

  it('falls back to a non-clickable toast when the action url is malformed', async () => {
    renderHarness('test-user');
    emit(frame({
      title: 'Broken action',
      body: 'still shows',
      actions: [{ label: 'Open', action: 'navigate', data: { url: 'ht!tp://[bad' } }],
    }));

    await waitFor(() => {
      expect(screen.getByText('Broken action')).toBeInTheDocument();
    });
    // Body still rendered, but no actionable element — rendering did not throw.
    expect(screen.getByText('still shows')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-action')).toBeNull();
  });

  it('does not render the same intent twice when the socket redelivers', async () => {
    renderHarness('test-user');
    const f = frame({ title: 'Dedupe me', createdAt: '2026-07-10T12:00:00Z', metadata: { id: 'evt-1' } });
    emit(f);
    emit(f);

    await waitFor(() => {
      expect(screen.getByText('Dedupe me')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Dedupe me')).toHaveLength(1);
  });
});
