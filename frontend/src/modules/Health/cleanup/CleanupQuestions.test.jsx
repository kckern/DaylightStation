import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
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
    return structuredClone(state);
  });
});
const mount = component => render(<MantineProvider>{component}</MantineProvider>);
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
  it('uses preview defaults and sends settings with the current revision', async () => {
    state.questions = []; mount(<HealthSettings />);
    const automatic = await screen.findByLabelText('Automatic cleanup');
    expect(automatic.checked).toBe(false);
    expect(screen.getByLabelText('Preview only — do not change food or send questions').checked).toBe(true);
    fireEvent.click(automatic);
    await waitFor(() => expect(api).toHaveBeenCalledWith(`${cleanupPath}/settings`, { expectedVersion: 1, enabled: true }, 'PATCH'));
  });
});
