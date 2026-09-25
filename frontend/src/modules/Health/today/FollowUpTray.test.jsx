import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { FollowUpTray } from './FollowUpTray.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

const api = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...args) => api(...args) }));

const question = { id: 'q1', version: 1, status: 'open', question: 'Which fish?', entryNames: {},
  choices: [{ id: '0', label: 'Cod', repair: { updates: [], createGroups: [] } }] };
let questions;
beforeEach(() => {
  resetApiResourceCache(); api.mockReset(); questions = [];
  api.mockImplementation(async () => ({ version: 1, questions }));
});
const mount = props => render(<MantineProvider><FollowUpTray {...props} /></MantineProvider>);

describe('FollowUpTray', () => {
  it('with nothing waiting: a quiet bell, no badge, and no words on the page', async () => {
    const { container } = mount({});
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container.querySelector('.health-followups--empty')).toBeTruthy();
    expect(container.querySelector('.health-followups__badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'No follow-ups' })).toBeTruthy();
  });

  it('renders into the header slot it is given, not into the page', async () => {
    const slot = document.createElement('span');
    document.body.appendChild(slot);
    const { container } = mount({ target: slot });
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(slot.querySelector('.health-followups')).toBeTruthy();
    expect(container.querySelector('.health-followups')).toBeNull();
    slot.remove();
  });

  it('counts questions and scale readings on a red badge; the questions are NOT on the page', async () => {
    questions = [question, { ...question, id: 'q2' }];
    const { container } = mount({ observations: [{ id: 'o1', kind: 'weight', value: 82, unit: 'g', status: 'open' }] });
    expect(await screen.findByRole('button', { name: '2 follow-up questions · 1 scale reading' })).toBeTruthy();
    expect(container.querySelector('.health-followups__badge').textContent).toBe('3');
    expect(screen.queryByText('Which fish?')).toBeNull();
  });

  it('the bell drops down what is waiting; picking a question opens the deck ON that question', async () => {
    questions = [question, { ...question, id: 'q2', question: 'Which bread?' }];
    mount({});
    fireEvent.click(await screen.findByRole('button', { name: '2 follow-up questions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Which bread\?/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Follow-ups' });
    expect(dialog.textContent).toContain('Which bread?');
    expect(dialog.textContent).toContain('2 of 2');
    expect(dialog.textContent).not.toContain('Which fish?');
  });

  it('keeps the "entry changed" message after a stale answer to the LAST question', async () => {
    questions = [question];
    api.mockImplementation(async (path, body, method) => {
      if (method === 'POST') { questions = []; return { status: 'stale', outcome: { message: 'The entry changed. Please review it manually.' } }; }
      return { version: 1, questions };
    });
    mount({});
    fireEvent.click(await screen.findByRole('button', { name: '1 follow-up question' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Which fish\?/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Cod/ }));
    expect(await screen.findByText('The entry changed. Please review it manually.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'A follow-up needs a look' })).toBeTruthy();
  });

  it('has one persistent live region carrying the summary', async () => {
    const { container } = mount({});
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container.querySelector('.health-followups [aria-live="polite"]').textContent).toBe('No follow-ups');
  });

  it('polls the cleanup endpoint once, shared with the questions it renders', async () => {
    questions = [question];
    mount({});
    await screen.findByRole('button', { name: '1 follow-up question' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(api.mock.calls.filter(([path]) => String(path).endsWith('nutrition/cleanup'))).toHaveLength(1);
  });
});
