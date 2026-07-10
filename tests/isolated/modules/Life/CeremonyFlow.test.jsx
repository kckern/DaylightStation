// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { CeremonyFlow } from '#frontend/modules/Life/views/ceremony/CeremonyFlow.jsx';

/** Probe that exposes the current route so navigation clicks can be asserted. */
const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-probe">{location.pathname}</div>;
};

const renderFlow = (props) => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[`/life/ceremony/${props.type}`]}>
      <Routes>
        <Route path="*" element={<><CeremonyFlow {...props} /><LocationProbe /></>} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>
);

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('CeremonyFlow error states', () => {
  it('renders the friendly no-plan card (not a raw error string) on NO_PLAN', async () => {
    fetch.mockResolvedValue(jsonResponse(404, {
      error: 'No life plan exists for this user yet',
      code: 'NO_PLAN',
    }));

    renderFlow({ type: 'unit_intention' });

    await waitFor(() => {
      expect(screen.getByText("You don't have a life plan yet")).toBeInTheDocument();
    });
    expect(screen.getByText('Ceremonies work against your plan — create one first.')).toBeInTheDocument();
    expect(screen.queryByText(/HTTP \d+/)).toBeNull();

    // Primary CTA navigates to the coach
    fireEvent.click(screen.getByRole('button', { name: 'Talk to your coach' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/life/coach');
  });

  it('secondary link on the no-plan card navigates to /life/plan', async () => {
    fetch.mockResolvedValue(jsonResponse(404, {
      error: 'No life plan exists for this user yet',
      code: 'NO_PLAN',
    }));

    renderFlow({ type: 'unit_intention' });

    await waitFor(() => {
      expect(screen.getByText('View your plan')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('View your plan'));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/life/plan');
  });

  it('renders the backend error message (not "HTTP 400") for other failures', async () => {
    fetch.mockResolvedValue(jsonResponse(400, { error: 'Unknown ceremony type: bogus' }));

    renderFlow({ type: 'bogus' });

    await waitFor(() => {
      expect(screen.getByText('Unknown ceremony type: bogus')).toBeInTheDocument();
    });
    expect(screen.queryByText('HTTP 400')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Talk to your coach' })).toBeNull();
  });

  it('falls back to a friendly message when the error body is not JSON', async () => {
    fetch.mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });

    renderFlow({ type: 'unit_intention' });

    await waitFor(() => {
      expect(screen.getByText('Request failed (HTTP 502)')).toBeInTheDocument();
    });
  });
});

describe('CeremonyFlow unimplemented types', () => {
  const advanceToLastStep = () => {
    // Every CEREMONY_STEPS entry has 3 steps → two Next clicks reach the last
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  };

  it('shows coming-soon notice and suppresses Complete for season_alignment', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { type: 'season_alignment', periodId: '2026-S3' }));

    renderFlow({ type: 'season_alignment' });

    await waitFor(() => {
      expect(screen.getByText(/This ceremony is coming soon/)).toBeInTheDocument();
    });
    advanceToLastStep();

    expect(screen.queryByRole('button', { name: /Complete/ })).toBeNull();
    expect(screen.getByText(/completing it is disabled so it stays on your schedule/)).toBeInTheDocument();
  });

  it('still shows Complete on the last step for an implemented type', async () => {
    fetch.mockResolvedValue(jsonResponse(200, { type: 'unit_intention', periodId: '2026-U555', activeGoals: [] }));

    renderFlow({ type: 'unit_intention' });

    await waitFor(() => {
      expect(screen.getByText('Active Goals')).toBeInTheDocument();
    });
    advanceToLastStep();

    expect(screen.getByRole('button', { name: /Complete/ })).toBeInTheDocument();
  });
});
