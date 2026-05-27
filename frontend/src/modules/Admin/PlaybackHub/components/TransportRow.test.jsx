import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { TransportRow } from './TransportRow.jsx';

// Stub LabeledContentPicker so we can drive its onChange directly.
let pickerOnChangeRef = null;
let pickerValueRef = null;
vi.mock('./LabeledContentPicker.jsx', () => ({
  LabeledContentPicker: function PickerStub({ value, onChange, placeholder }) {
    pickerOnChangeRef = onChange;
    pickerValueRef = value;
    return (
      <input
        data-testid="picker-stub"
        data-value={value || ''}
        data-placeholder={placeholder || ''}
        readOnly
      />
    );
  },
}));

function mkSlot(overrides = {}) {
  return {
    slot: 1,
    color: 'red',
    name: 'musiCozy',
    class: 'private',
    mac: '41:42:3A:E5:43:07',
    volume: { default: 50, min: 0, max: 75 },
    ...overrides,
  };
}

function mkStatus(overrides = {}) {
  return {
    position: 1,
    color: 'red',
    bt_connected: true,
    paused: false,
    now_playing: null,
    volume: 45,
    playlist_pos: 0,
    playlist_count: 0,
    armed_source: null,
    ...overrides,
  };
}

function renderTransport(props) {
  return render(
    <MantineProvider>
      <TransportRow {...props} />
    </MantineProvider>
  );
}

describe('TransportRow', () => {
  let mutations;

  beforeEach(() => {
    pickerOnChangeRef = null;
    pickerValueRef = null;
    mutations = {
      sendCommand: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fires prev mutation when Prev button clicked', () => {
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });
    fireEvent.click(screen.getByRole('button', { name: /prev/i }));
    expect(mutations.sendCommand).toHaveBeenCalledTimes(1);
    expect(mutations.sendCommand).toHaveBeenCalledWith({
      action: 'prev',
      target: 'red',
    });
  });

  it('fires next mutation when Next button clicked', () => {
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(mutations.sendCommand).toHaveBeenCalledTimes(1);
    expect(mutations.sendCommand).toHaveBeenCalledWith({
      action: 'next',
      target: 'red',
    });
  });

  it('fires pause mutation when Pause/Play button clicked', () => {
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });
    // Pause button uses aria-label "pause" (when not paused) — exact match
    fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    expect(mutations.sendCommand).toHaveBeenCalledWith({
      action: 'pause',
      target: 'red',
    });
  });

  it('Pause button toggles aria-label to "play" when status.paused is true', () => {
    renderTransport({
      slot: mkSlot(),
      status: mkStatus({ paused: true }),
      mutations,
    });
    // When paused, aria-label is "play"
    const btn = screen.getByRole('button', { name: 'play' });
    fireEvent.click(btn);
    expect(mutations.sendCommand).toHaveBeenCalledWith({
      action: 'pause',
      target: 'red',
    });
  });

  it('debounces volume slider change and fires once after 300ms', async () => {
    vi.useFakeTimers();
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    const slider = screen.getByRole('slider');

    // Simulate multiple rapid changes via Mantine's onChange.
    // Mantine's Slider supports keyboard ArrowRight (increment).
    act(() => {
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
      fireEvent.keyDown(slider, { key: 'ArrowRight' });
    });

    // Before debounce window passes, no call yet.
    expect(mutations.sendCommand).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(310);
    });

    expect(mutations.sendCommand).toHaveBeenCalledTimes(1);
    const call = mutations.sendCommand.mock.calls[0][0];
    expect(call.action).toBe('volume');
    expect(call.target).toBe('red');
    expect(typeof call.volume).toBe('number');
  });

  it('Play Now is disabled when no content picked', () => {
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });
    const playNow = screen.getByRole('button', { name: /play now/i });
    expect(playNow).toBeDisabled();
  });

  it('Play Now fires play mutation with picked contentId', () => {
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    // Drive the picker's onChange with a real value
    act(() => {
      pickerOnChangeRef('plex:670208', {
        id: 'plex:670208',
        title: 'Some Track',
      });
    });

    const playNow = screen.getByRole('button', { name: /play now/i });
    expect(playNow).not.toBeDisabled();

    fireEvent.click(playNow);

    expect(mutations.sendCommand).toHaveBeenCalledWith({
      action: 'play',
      target: 'red',
      contentId: 'plex:670208',
    });
  });

  it('freeform commit (no item) still enables Play Now if value is non-empty', () => {
    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    act(() => {
      pickerOnChangeRef('plex:9999');
    });

    const playNow = screen.getByRole('button', { name: /play now/i });
    expect(playNow).not.toBeDisabled();
  });

  it('handles missing status by using slot.volume.default for slider value', () => {
    renderTransport({ slot: mkSlot(), status: undefined, mutations });
    const slider = screen.getByRole('slider');
    // aria-valuenow reflects current value
    expect(slider.getAttribute('aria-valuenow')).toBe('50');
  });

  it('disables Play Now button while sendCommand is in flight', async () => {
    let resolveCmd;
    const pending = new Promise((resolve) => { resolveCmd = resolve; });
    mutations.sendCommand = vi.fn().mockReturnValue(pending);

    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    act(() => {
      pickerOnChangeRef('plex:42');
    });

    const playBtn = screen.getByRole('button', { name: /^play now$/i });
    expect(playBtn).not.toBeDisabled();

    fireEvent.click(playBtn);
    expect(playBtn).toBeDisabled();

    await act(async () => {
      resolveCmd({ ok: true, result: { applied: ['red'], skipped: [] } });
    });

    expect(screen.getByRole('button', { name: /^play now$/i })).not.toBeDisabled();
  });

  it('does not crash if sendCommand returns { ok: false }', async () => {
    mutations.sendCommand = vi.fn().mockResolvedValue({
      ok: false,
      error: new Error('HTTP 502'),
    });

    renderTransport({ slot: mkSlot(), status: mkStatus(), mutations });

    act(() => {
      pickerOnChangeRef('plex:42');
    });

    fireEvent.click(screen.getByRole('button', { name: /^play now$/i }));
    await act(async () => { await Promise.resolve(); });
    const playBtn = screen.getByRole('button', { name: /^play now$/i });
    expect(playBtn).not.toBeDisabled();
  });
});
