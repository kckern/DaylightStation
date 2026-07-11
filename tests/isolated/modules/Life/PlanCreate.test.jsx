// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GoalsView } from '#frontend/modules/Life/views/plan/GoalsView.jsx';
import { ValuesView } from '#frontend/modules/Life/views/plan/ValuesView.jsx';
import { BeliefsView } from '#frontend/modules/Life/views/plan/BeliefsView.jsx';

const renderAt = (element, initial = '/life/plan') => render(
  <MantineProvider>
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="*" element={element} />
      </Routes>
    </MemoryRouter>
  </MantineProvider>
);

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Returns the [url, options] of the first POST fetch call, or null. */
const lastPost = () => {
  const call = fetch.mock.calls.find(([, opts]) => opts?.method === 'POST');
  return call || null;
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('GoalsView create-goal flow', () => {
  it('opens the modal, POSTs the goal, and refetches so the new goal renders', async () => {
    let created = false;
    fetch.mockImplementation((url, opts) => {
      if (url.includes('/life/plan/goals') && opts?.method === 'POST') {
        created = true;
        return Promise.resolve(jsonResponse(201, { id: 'g-new', name: 'Run a 5k', state: 'dream' }));
      }
      if (url.includes('/life/plan/goals')) {
        return Promise.resolve(jsonResponse(200, { goals: created ? [{ id: 'g-new', name: 'Run a 5k', state: 'dream' }] : [] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    renderAt(<GoalsView username="test-user" />);

    // Empty state renders its own "Add goal" button
    await waitFor(() => expect(screen.getByText(/No goals yet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));

    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText(/Goal/i);
    const submit = within(dialog).getByRole('button', { name: 'Create goal' });

    // Submit is disabled until a name is entered
    expect(submit).toBeDisabled();
    fireEvent.change(nameInput, { target: { value: 'Run a 5k' } });
    fireEvent.change(within(dialog).getByLabelText(/Why does this matter/i), { target: { value: 'health' } });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    // POST fired to the right URL with the right body
    await waitFor(() => expect(lastPost()).not.toBeNull());
    const [url, opts] = lastPost();
    expect(url).toContain('/life/plan/goals');
    expect(url).toContain('username=test-user');
    expect(JSON.parse(opts.body)).toMatchObject({ name: 'Run a 5k', why: 'health' });

    // Refetch happened → the new goal is now on the board and the modal closed
    await waitFor(() => expect(screen.getByText('Run a 5k')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the modal open and shows an alert when the POST fails', async () => {
    fetch.mockImplementation((url, opts) => {
      if (url.includes('/life/plan/goals') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse(500, { error: 'disk full' }));
      }
      if (url.includes('/life/plan/goals')) return Promise.resolve(jsonResponse(200, { goals: [] }));
      return Promise.resolve(jsonResponse(200, {}));
    });

    renderAt(<GoalsView username="test-user" />);
    await waitFor(() => expect(screen.getByText(/No goals yet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Goal/i), { target: { value: 'Nope' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create goal' }));

    await waitFor(() => expect(within(dialog).getByText('disk full')).toBeInTheDocument());
    // Modal is still open
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ValuesView create-value flow', () => {
  it('opens the modal, POSTs the value, and refetches so it renders', async () => {
    let created = false;
    fetch.mockImplementation((url, opts) => {
      if (url.includes('/life/plan/values') && opts?.method === 'POST') {
        created = true;
        return Promise.resolve(jsonResponse(201, { id: 'v-new', name: 'Integrity', rank: 1 }));
      }
      // full plan GET
      if (url.includes('/life/plan')) {
        return Promise.resolve(jsonResponse(200, { values: created ? [{ id: 'v-new', name: 'Integrity', rank: 1 }] : [] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    renderAt(<ValuesView username="test-user" />);
    await waitFor(() => expect(screen.getByText('Values')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add value' }));

    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Create value' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Value/i), { target: { value: 'Integrity' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(lastPost()).not.toBeNull());
    const [url, opts] = lastPost();
    expect(url).toContain('/life/plan/values');
    expect(url).toContain('username=test-user');
    expect(JSON.parse(opts.body)).toMatchObject({ name: 'Integrity' });

    await waitFor(() => expect(screen.getByText('Integrity')).toBeInTheDocument());
  });
});

describe('BeliefsView create-belief flow', () => {
  it('opens the modal, POSTs both fields, and refetches so it renders', async () => {
    let created = false;
    fetch.mockImplementation((url, opts) => {
      if (url.includes('/life/plan/beliefs') && opts?.method === 'POST') {
        created = true;
        return Promise.resolve(jsonResponse(201, { id: 'b-new', if_hypothesis: 'I practice daily', then_expectation: 'I improve' }));
      }
      if (url.includes('/life/plan/beliefs')) {
        return Promise.resolve(jsonResponse(200, { beliefs: created ? [{ id: 'b-new', if_hypothesis: 'I practice daily', then_expectation: 'I improve', state: 'hypothesized' }] : [] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    renderAt(<BeliefsView username="test-user" />);
    await waitFor(() => expect(screen.getByText('Beliefs')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Add belief' }));

    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: 'Create belief' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/If I/i), { target: { value: 'I practice daily' } });
    // Both fields required — still disabled with only one filled
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/then/i), { target: { value: 'I improve' } });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => expect(lastPost()).not.toBeNull());
    const [url, opts] = lastPost();
    expect(url).toContain('/life/plan/beliefs');
    expect(url).toContain('username=test-user');
    expect(JSON.parse(opts.body)).toMatchObject({ if_hypothesis: 'I practice daily', then_outcome: 'I improve' });

    await waitFor(() => expect(screen.getByText(/I practice daily/)).toBeInTheDocument());
  });
});
