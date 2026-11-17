import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DispatchContext } from "../cast/DispatchProvider.jsx";

const bridge = { canPinMedia: vi.fn(() => false), pinMedia: vi.fn(() => ({ accepted: true })) };
vi.mock("../../../../../frontend/src/lib/fkb.js", () => ({
  canPinMedia: (...args) => bridge.canPinMedia(...args),
  pinMedia: (...args) => bridge.pinMedia(...args),
}));
const logged = [];
vi.mock("../logging/mediaLog.js", () => {
  const record = (event) => (data) => logged.push([event, data]);
  const mediaLog = new Proxy({}, { get: (_t, key) => record(String(key)) });
  return { mediaLog, default: mediaLog };
});

import { AddToHomeScreenButton, PIN_COOLDOWN_MS } from "./AddToHomeScreenButton.jsx";

const PLAYLIST = { contentId: 'plex:900', label: 'Road trip', kind: 'container' };

function renderButton(target = PLAYLIST, recordLocal = vi.fn()) {
  const utils = render(
    <MantineProvider>
      <DispatchContext.Provider value={{ recordLocal }}>
        <AddToHomeScreenButton target={target} />
      </DispatchContext.Provider>
    </MantineProvider>,
  );
  const rerenderWith = (next) => utils.rerender(
    <MantineProvider>
      <DispatchContext.Provider value={{ recordLocal }}>
        <AddToHomeScreenButton target={next} />
      </DispatchContext.Provider>
    </MantineProvider>,
  );
  return { ...utils, recordLocal, rerenderWith };
}

const button = () => screen.queryByRole('button', { name: /add to home screen/i });
const outcomeText = (recordLocal) => recordLocal.mock.calls.at(-1)?.[0]?.command?.copy?.primary;

beforeEach(() => {
  bridge.canPinMedia.mockReset().mockReturnValue(false);
  bridge.pinMedia.mockReset().mockReturnValue({ accepted: true });
  logged.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AddToHomeScreenButton', () => {
  it('is hidden without the phone bridge', () => {
    renderButton();
    expect(button()).toBeNull();
  });

  it('is hidden when canPinMedia() is false', () => {
    bridge.canPinMedia.mockReturnValue(false);
    renderButton();
    expect(bridge.canPinMedia).toHaveBeenCalled();
    expect(button()).toBeNull();
  });

  it('is shown when canPinMedia() is true', () => {
    bridge.canPinMedia.mockReturnValue(true);
    renderButton();
    expect(button()).not.toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('is hidden when there is nothing to pin', () => {
    bridge.canPinMedia.mockReturnValue(true);
    renderButton(null);
    expect(button()).toBeNull();
  });

  it('asks again when the item changes', () => {
    bridge.canPinMedia.mockReturnValue(true);
    const { rerenderWith } = renderButton();
    const before = bridge.canPinMedia.mock.calls.length;
    bridge.canPinMedia.mockReturnValue(false);
    rerenderWith({ contentId: 'plex:901', label: 'Other', kind: 'container' });
    expect(bridge.canPinMedia.mock.calls.length).toBeGreaterThan(before);
    expect(button()).toBeNull();
  });

  it('sends the content id and label on a tap', () => {
    bridge.canPinMedia.mockReturnValue(true);
    renderButton();
    fireEvent.click(button());
    expect(bridge.pinMedia).toHaveBeenCalledTimes(1);
    expect(bridge.pinMedia).toHaveBeenCalledWith({ contentId: 'plex:900', label: 'Road trip' });
  });

  it('sanitizes a label that reaches it unsanitized', () => {
    bridge.canPinMedia.mockReturnValue(true);
    renderButton({ contentId: 'plex:900', label: '‮Road​ trip\n', kind: 'container' });
    fireEvent.click(button());
    expect(bridge.pinMedia).toHaveBeenCalledWith({ contentId: 'plex:900', label: 'Road trip' });
  });

  it.each([
    [{ accepted: true }, "Confirm on your phone's dialog", 'confirmed'],
    [{ accepted: false, reason: 'rate_limited' }, 'One moment, then try again', 'failed'],
    [{ accepted: false, reason: 'launcher_cannot_pin' }, "This phone's home screen can't add shortcuts", 'failed'],
    [{ accepted: false, reason: 'invalid_label' }, "Couldn't add to home screen", 'failed'],
    [{ accepted: false, reason: 'refused' }, "Couldn't add to home screen", 'failed'],
    [{ accepted: false, reason: 'failed' }, "Couldn't add to home screen", 'failed'],
  ])('reports %j through the outcome tray', (answer, message, phase) => {
    bridge.canPinMedia.mockReturnValue(true);
    bridge.pinMedia.mockReturnValue(answer);
    const { recordLocal } = renderButton();
    fireEvent.click(button());
    expect(recordLocal).toHaveBeenCalledTimes(1);
    const record = recordLocal.mock.calls[0][0];
    expect(record.phase).toBe(phase);
    expect(outcomeText(recordLocal)).toBe(message);
    // The record carries no content id, so the outcome log line cannot either,
    // and the tray offers no Retry.
    expect(record.item?.contentId ?? null).toBeNull();
    expect(JSON.stringify(record)).not.toContain('plex:900');
  });

  it('is disabled for five seconds after a tap', () => {
    vi.useFakeTimers();
    bridge.canPinMedia.mockReturnValue(true);
    renderButton();
    fireEvent.click(button());
    expect(PIN_COOLDOWN_MS).toBe(5000);
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(bridge.pinMedia).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(PIN_COOLDOWN_MS - 1); });
    expect(button().disabled).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    expect(bridge.pinMedia).toHaveBeenCalledTimes(2);
  });

  it('never logs the content id or the label', () => {
    bridge.canPinMedia.mockReturnValue(true);
    renderButton();
    fireEvent.click(button());
    const text = JSON.stringify(logged);
    expect(logged.some(([event]) => event === 'homeScreenPinRequested')).toBe(true);
    expect(text).not.toContain('plex:900');
    expect(text).not.toContain('Road trip');
  });
});
