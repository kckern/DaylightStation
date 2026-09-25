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
  it('holds its slot with nothing to follow up', async () => {
    const { container } = mount({});
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container.querySelector('.health-followups--empty').textContent).toBe('No follow-ups');
  });

  it('summarises questions and scale readings in one line; the questions are NOT on the page', async () => {
    questions = [question, { ...question, id: 'q2' }];
    mount({ observations: [{ id: 'o1', kind: 'weight', value: 82, unit: 'g', status: 'open' }] });
    expect(await screen.findByText('2 follow-up questions · 1 scale reading')).toBeTruthy();
    expect(screen.queryByText('Which fish?')).toBeNull();
  });

  it('tapping the line opens a sheet with ONE question card at a time', async () => {
    questions = [question, { ...question, id: 'q2', question: 'Which bread?' }];
    mount({});
    fireEvent.click(await screen.findByText('2 follow-up questions'));
    const dialog = await screen.findByRole('dialog', { name: 'Follow-ups' });
    expect(dialog.textContent).toContain('Which fish?');
    expect(dialog.textContent).toContain('1 of 2');
    expect(dialog.textContent).not.toContain('Which bread?');
  });

  it('keeps the "entry changed" message after a stale answer to the LAST question', async () => {
    questions = [question];
    api.mockImplementation(async (path, body, method) => {
      if (method === 'POST') { questions = []; return { status: 'stale', outcome: { message: 'The entry changed. Please review it manually.' } }; }
      return { version: 1, questions };
    });
    mount({});
    fireEvent.click(await screen.findByText('1 follow-up question'));
    fireEvent.click(await screen.findByRole('button', { name: /Cod/ }));
    expect(await screen.findByText('The entry changed. Please review it manually.')).toBeTruthy();
    expect(await screen.findByText('A follow-up needs a look')).toBeTruthy();
  });

  it('is one persistent line whose text is the live region', async () => {
    const { container } = mount({});
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(container.querySelector('.health-followups [aria-live="polite"]').textContent).toBe('No follow-ups');
  });

  it('polls the cleanup endpoint once, shared with the questions it renders', async () => {
    questions = [question];
    mount({});
    await screen.findByText('1 follow-up question');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(api.mock.calls.filter(([path]) => String(path).endsWith('nutrition/cleanup'))).toHaveLength(1);
  });
});
