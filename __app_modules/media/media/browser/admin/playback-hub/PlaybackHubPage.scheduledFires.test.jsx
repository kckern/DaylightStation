import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const hubConfigState = {
  config: {
    devices: [{ color: 'red', class: 'private', volume: { default: 50, min: 0, max: 75 } }],
    scheduled: [],
  },
  loading: false,
  error: null,
};
const hubStatusState = { devices: new Map(), fetchedAt: new Date() };
const hubMutations = {
  sendCommand: vi.fn(),
  updateDevice: vi.fn(),
  saveFire: vi.fn(),
  deleteFire: vi.fn(),
};

vi.mock("./hooks/useHubStatus.js", () => ({
  useHubStatus: () => hubStatusState,
}));

vi.mock("./hooks/useHubConfig.js", () => ({
  useHubConfig: () => ({ ...hubConfigState, revalidate: vi.fn() }),
}));

vi.mock("./hooks/useHubMutations.js", () => ({
  useHubMutations: () => hubMutations,
}));

vi.mock("../../../../../../__capabilities/content-catalog/browser/picker.mjs", () => ({
  default: function PickerStub({ value, onChange }) {
    return <input aria-label="Queue" value={value || ''} onChange={(event) => onChange(event.target.value)} />;
  },
}));

import PlaybackHubPage from "./PlaybackHubPage.jsx";

describe('PlaybackHubPage scheduled-fire draft lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T12:00:00.000Z'));
    hubStatusState.fetchedAt = new Date('2026-11-22T11:59:49.000Z');
    hubMutations.saveFire.mockReset().mockResolvedValue({ ok: true });
    hubMutations.deleteFire.mockReset().mockResolvedValue({ ok: true });
    hubMutations.updateDevice.mockReset().mockResolvedValue({ ok: true });
    hubMutations.sendCommand.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a new fire draft through the one-second status display tick', async () => {
    render(
      <MantineProvider>
        <PlaybackHubPage />
      </MantineProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    fireEvent.click(screen.getByRole('button', { name: /scheduled fires/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    fireEvent.click(screen.getByRole('button', { name: /^add fire$/i }));
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '08:30' } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText(/last update 13s ago/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/time/i)).toHaveValue('08:30');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save fire$/i }));
    });

    expect(hubMutations.saveFire).toHaveBeenCalledTimes(1);
    expect(hubMutations.saveFire.mock.calls[0][0]).toMatchObject({
      time: '08:30',
      target: 'red',
    });
  });
});
