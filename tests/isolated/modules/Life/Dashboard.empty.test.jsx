// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Dashboard } from '#frontend/modules/Life/views/now/Dashboard.jsx';
import { GoalsView } from '#frontend/modules/Life/views/plan/GoalsView.jsx';

/** Probe that exposes the current route so navigation clicks can be asserted. */
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
};

const renderAt = (element, initial = '/life/now') => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="*" element={<>{element}<LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>
);

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });

/**
 * Dashboard hits three endpoints (now?mode=priorities, now?mode=dashboard, plan/).
 * GoalsView hits plan/goals. Route the mock by URL so every call resolves.
 */
const mockFetchByUrl = ({ plan = {}, goals = [] } = {}) => {
  fetch.mockImplementation((url) => {
    if (url.includes('/life/now?mode=priorities')) return Promise.resolve(jsonResponse({ priorities: [] }));
    if (url.includes('/life/now?mode=dashboard')) return Promise.resolve(jsonResponse({ dashboard: {} }));
    if (url.includes('/life/plan/goals')) return Promise.resolve(jsonResponse({ goals }));
    if (url.includes('/life/plan')) return Promise.resolve(jsonResponse(plan));
    return Promise.resolve(jsonResponse({}));
  });
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('Dashboard empty-plan funnel', () => {
  it('renders the onboarding card and routes to the coach when the plan is empty', async () => {
    mockFetchByUrl({ plan: {} });

    renderAt(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText("You don't have a life plan yet")).toBeInTheDocument();
    });
    expect(screen.getByText(/Ten minutes with your coach/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Talk to your coach' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/life/coach');
  });

  it('secondary link routes to the life log', async () => {
    mockFetchByUrl({ plan: {} });

    renderAt(<Dashboard />);

    await waitFor(() => {
      expect(screen.getByText('Browse my life log first')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Browse my life log first'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/life/log');
  });

  it('omits the onboarding card when the plan has a goal', async () => {
    mockFetchByUrl({ plan: { goals: [{ id: 'g1', name: 'Run a 5k', state: 'committed' }] } });

    renderAt(<Dashboard />);

    // Wait until loading settles (priorities card title renders unconditionally).
    await waitFor(() => {
      expect(screen.getByText('Priorities')).toBeInTheDocument();
    });
    expect(screen.queryByText("You don't have a life plan yet")).toBeNull();
  });
});

describe('GoalsView empty state', () => {
  it('renders empty copy (not a blank page) when there are no goals', async () => {
    mockFetchByUrl({ goals: [] });

    renderAt(<GoalsView username="test-user" />, '/life/plan/goals');

    await waitFor(() => {
      expect(screen.getByText(/No goals yet/)).toBeInTheDocument();
    });
  });

  it('renders the goal grid when goals exist', async () => {
    mockFetchByUrl({ goals: [{ id: 'g1', name: 'Run a 5k', state: 'committed' }] });

    renderAt(<GoalsView username="test-user" />, '/life/plan/goals');

    await waitFor(() => {
      expect(screen.getByText('Run a 5k')).toBeInTheDocument();
    });
    expect(screen.queryByText(/No goals yet/)).toBeNull();
  });
});
