import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

  it('summarises questions and scale readings in one collapsed line', async () => {
    questions = [question, { ...question, id: 'q2' }];
    const { container } = mount({ observations: [{ id: 'o1', kind: 'weight', value: 82, unit: 'g', status: 'open' }] });
    expect(await screen.findByText('2 follow-up questions · 1 scale reading')).toBeTruthy();
    const tray = container.querySelector('details.health-followups');
    expect(tray.open).toBe(false);
    // The questions are inside the tray, not in the page flow above the log.
    expect(tray.contains(screen.getAllByText('Which fish?')[0])).toBe(true);
  });

  it('keeps the "entry changed" message after a stale answer to the LAST question', async () => {
    questions = [question];
    api.mockImplementation(async (path, body, method) => {
      if (method === 'POST') { questions = []; return { status: 'stale', outcome: { message: 'The entry changed. Please review it manually.' } }; }
      return { version: 1, questions };
    });
    const { container } = mount({});
    await screen.findByText('1 follow-up question');
    container.querySelector('details').open = true;
    screen.getByRole('button', { name: 'Cod' }).click();
    expect(await screen.findByText('The entry changed. Please review it manually.')).toBeTruthy();
    // Once the reload finds no questions, the line still has something to say.
    expect(await screen.findByText('A follow-up needs a look')).toBeTruthy();
    expect(screen.getByText('The entry changed. Please review it manually.')).toBeTruthy();
  });

  it('is one persistent element whose summary text is the live region', async () => {
    const { container } = mount({});
    await waitFor(() => expect(api).toHaveBeenCalled());
    const tray = container.querySelector('details.health-followups');
    expect(tray.querySelector('summary [aria-live="polite"]').textContent).toBe('No follow-ups');
  });

  it('polls the cleanup endpoint once, shared with the questions it renders', async () => {
    questions = [question];
    mount({});
    await screen.findByText('1 follow-up question');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(api.mock.calls.filter(([path]) => String(path).endsWith('nutrition/cleanup'))).toHaveLength(1);
  });
});
