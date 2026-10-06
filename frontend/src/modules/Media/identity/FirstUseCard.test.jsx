// RQ-RELY-12 (RELY.14a): a name prompt with a default and Skip, and the aim
// label explained once.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const identity = vi.hoisted(() => ({ value: null }));
vi.mock('./useClientIdentity.js', () => ({ useClientIdentity: () => identity.value }));
vi.mock('../cast/AimLabel.jsx', () => ({ GlobalAimLabel: () => <span data-testid="aim-label">Aim: This device</span> }));

import { FirstUseCard, suggestDeviceName } from './FirstUseCard.jsx';

beforeEach(() => {
  identity.value = { firstUse: true, deviceId: 'browser:a', rename: vi.fn(async () => ({ ok: true })), completeFirstUse: vi.fn() };
});
const wrap = () => render(<MantineProvider><FirstUseCard /></MantineProvider>);

describe('FirstUseCard', () => {
  it('suggests a name from the kind of device', () => {
    expect(suggestDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari')).toBe('Android phone');
    expect(suggestDeviceName('Mozilla/5.0 (Linux; Android 13; SM-X200) Safari')).toBe('Android tablet');
    expect(suggestDeviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('Mac');
  });

  it('names the device and remembers the answer', async () => {
    wrap();
    expect(screen.getByTestId('first-use-aim')).toHaveTextContent('The aim label shows where Play sends things');
    expect(screen.getByTestId('aim-label')).toBeInTheDocument();
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

  it('is gone once answered', () => {
    identity.value.firstUse = false;
    wrap();
    expect(screen.queryByTestId('first-use-card')).toBeNull();
  });
});
