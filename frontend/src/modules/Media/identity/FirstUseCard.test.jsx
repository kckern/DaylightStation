// RQ-RELY-12 (RELY.14a): a small popover on the destination control — a name
// prompt with a default, Save / Not now, and where taps go explained once in a
// sentence. It owns no page space.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const identity = vi.hoisted(() => ({ value: null }));
vi.mock('./useClientIdentity.js', () => ({ useClientIdentity: () => identity.value }));

import { FirstUseCard, suggestDeviceName } from './FirstUseCard.jsx';

beforeEach(() => {
  identity.value = { firstUse: true, deviceId: 'browser:a', rename: vi.fn(async () => ({ ok: true })), completeFirstUse: vi.fn() };
});
const wrap = () => render(<MantineProvider><FirstUseCard><span data-testid="anchor">Playing on this device</span></FirstUseCard></MantineProvider>);

describe('FirstUseCard', () => {
  it('suggests a name from the kind of device', () => {
    expect(suggestDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('Android phone');
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 13; SM-X200) Safari')).toBe('Android tablet');
    expect(suggestDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
  });

  it('names the device and remembers the answer', async () => {
    wrap();
    expect(screen.getByRole('dialog', { name: 'What should we call this device?' })).toBeInTheDocument();
    expect(screen.getByTestId('first-use-aim')).toHaveTextContent('Things you play go to the device shown here. Tap it to change.');
    expect(screen.getByTestId('first-use-name')).toHaveValue(suggestDeviceName());
    expect(screen.getByTestId('first-use-skip')).toHaveTextContent('Not now');
    fireEvent.change(screen.getByTestId('first-use-name'), { target: { value: "Dad's phone" } });
    fireEvent.click(screen.getByTestId('first-use-save'));
    await waitFor(() => expect(identity.value.rename).toHaveBeenCalledWith({ name: "Dad's phone" }));
    expect(identity.value.completeFirstUse).toHaveBeenCalledWith('named');
  });

  it('can be skipped', () => {
    wrap();
    fireEvent.click(screen.getByTestId('first-use-skip'));
    expect(identity.value.completeFirstUse).toHaveBeenCalledWith('skipped');
  });

  it('offers the free name when the chosen one is taken', async () => {
    identity.value.rename = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'NAME_TAKEN', suggestion: 'iPhone (2)' })
      .mockResolvedValueOnce({ ok: true });
    wrap();
    fireEvent.click(screen.getByTestId('first-use-save'));
    fireEvent.click(await screen.findByTestId('first-use-suggestion'));
    await waitFor(() => expect(identity.value.rename).toHaveBeenLastCalledWith({ name: 'iPhone (2)' }));
  });

  it('is gone once answered, but the anchor stays', () => {
    identity.value.firstUse = false;
    wrap();
    expect(screen.queryByTestId('first-use-card')).toBeNull();
    expect(screen.getByTestId('anchor')).toBeInTheDocument();
  });

  it('takes no page space: the card is a popover, not a block of the page', () => {
    const { container } = wrap();
    expect(container.querySelector('[data-testid="first-use-card"]')).toBeNull();
    expect(screen.getByTestId('first-use-card').closest('.mantine-Popover-dropdown')).not.toBeNull();
  });
});
