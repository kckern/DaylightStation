import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { CleanupQuestions, cleanupPath } from './CleanupQuestions.jsx';
import { HealthSettings } from './HealthSettings.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';
const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

let state;
beforeEach(() => {
  resetApiResourceCache(); api.mockReset();
  state = { version: 1, settings: { enabled: false, dryRun: true, telegram: false }, runs: [], questions: [
    { id: 'question', version: 1, status: 'open', question: 'Which fish?', entryNames: { fish: 'White Fish' },
      choices: [{ id: '0', label: 'Cod', repair: { updates: [{ id: 'fish', changes: { name: 'Cod' } }], createGroups: [] } }] },
  ] };
  api.mockImplementation(async (path, body, method) => {
    if (method) return { status: 'resolved' };
    if (path.includes('/history')) return { records: [], total: 0 };
    if (path.includes('/spend')) return { today: 0.02, ledgerTodayUsd: 0.04, week: 0.1, month: 0.3, capUsd: 1, cappedToday: false };
    return structuredClone(state);
  });
});
const mount = component => render(<MantineProvider><MemoryRouter initialEntries={['/health/settings']}>{component}</MemoryRouter></MantineProvider>);
function Where() { return <div data-testid="where">{useLocation().pathname}</div>; }
describe('Health cleanup controls', () => {
  it('shows exact changes and sends versioned choices independently of Telegram', async () => {
    mount(<CleanupQuestions />);
    await screen.findByText('White Fish: name: Cod');
    fireEvent.click(screen.getByRole('button', { name: 'Cod', exact: true }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${cleanupPath}/questions/question/answer`,
      expect.objectContaining({ choiceId: '0', expectedVersion: 1, operationId: expect.any(String) }), 'POST'));
  });
  it('supports free responses and keeps stale-answer feedback after the question closes', async () => {
    api.mockImplementation(async (_path, _body, method) => {
      if (method) { state.questions = []; return { status: 'stale', outcome: { message: 'Food changed. Review it manually.' } }; }
      return structuredClone(state);
    });
    mount(<CleanupQuestions />); await screen.findByLabelText('Your answer');
    fireEvent.change(screen.getByLabelText('Your answer'), { target: { value: 'It was haddock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await screen.findByText('Food changed. Review it manually.');
    await waitFor(() => expect(screen.queryByText('Which fish?')).toBeNull());
    expect(screen.getByText('Food changed. Review it manually.')).toBeTruthy();
  });
  it('does not fetch for an inactive retained Today view', async () => {
    mount(<CleanupQuestions active={false} />);
    expect(api).not.toHaveBeenCalled();
  });
  it('leaves the auditor switches to the auditor page', async () => {
    state.questions = []; mount(<HealthSettings />);
    await screen.findByRole('button', { name: 'Open auditor' });
    expect(screen.queryByLabelText('Automatic cleanup')).toBeNull();
    expect(screen.queryByRole('button', { name: /cleanup now/ })).toBeNull();
  });
  it('shows a one-line auditor status and opens the auditor page', async () => {
    state.questions = [];
    state.runs = [{ id: 'r1', status: 'completed', createdAt: new Date().toISOString(), completedAt: new Date().toISOString() }];
    mount(<Routes>
      <Route path="/health/settings" element={<HealthSettings />} />
      <Route path="/health/auditor" element={<Where />} />
    </Routes>);
    await screen.findByText(/^Off · Last run .* · \$0\.04 today/);
    expect(screen.queryByText('Repair history')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open auditor' }));
    expect((await screen.findByTestId('where')).textContent).toBe('/health/auditor');
  });
});
