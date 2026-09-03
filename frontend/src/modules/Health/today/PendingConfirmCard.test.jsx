/**
 * The card resolves its callbacks by BUTTON LABEL. Captures are committed on
 * arrival now, so the server sends `↩️ Undo` / `✏️ Edit` — if the lookup still
 * matched only 'Discard'/'Accept' it would resolve null, skip the API call, and
 * close as though it worked while the entry stayed logged AND counting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn(async () => ({}));
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { PendingConfirmCard } from './PendingConfirmCard.jsx';

const committedMessages = [{
  text: 'Apple — 95 kcal',
  choices: [[
    { text: '↩️ Undo', callback_data: '{"cmd":"x","id":"log-1"}' },
    { text: '✏️ Edit', callback_data: '{"cmd":"r","id":"log-1"}' },
  ]],
}];

const mount = (props) => render(
  <MantineProvider>
    <PendingConfirmCard messages={committedMessages} onDone={() => {}} onDiscard={() => {}} {...props} />
  </MantineProvider>
);

describe('PendingConfirmCard', () => {
  beforeEach(() => apiMock.mockClear());

  it('Undo POSTs the x callback and only then calls onDiscard', async () => {
    const onDiscard = vi.fn();
    mount({ onDiscard });

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await waitFor(() => expect(onDiscard).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledTimes(1);
    const [path, body, method] = apiMock.mock.calls[0];
    expect(path).toContain('nutrition/callback');
    expect(method).toBe('POST');
    expect(JSON.parse(body.callbackData)).toEqual({ cmd: 'x', id: 'log-1' });
  });

  it('never closes silently when no callback resolves', async () => {
    const onDiscard = vi.fn();
    mount({ onDiscard, messages: [{ text: 'Apple — 95 kcal', choices: [[]] }] });

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await waitFor(() => expect(screen.getByText(/unavailable/i)).toBeTruthy());
    expect(apiMock).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('offers no Accept — the entry is already logged, Done just dismisses', async () => {
    const onDone = vi.fn();
    mount({ onDone });

    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('still resolves a legacy Discard label', async () => {
    const onDiscard = vi.fn();
    mount({
      onDiscard,
      messages: [{ text: 'Apple', choices: [[{ text: '🗑️ Discard', callback_data: '{"cmd":"x","id":"old"}' }]] }],
    });

    fireEvent.click(screen.getByRole('button', { name: /undo/i }));

    await waitFor(() => expect(onDiscard).toHaveBeenCalled());
    expect(JSON.parse(apiMock.mock.calls[0][1].callbackData)).toEqual({ cmd: 'x', id: 'old' });
  });
});
