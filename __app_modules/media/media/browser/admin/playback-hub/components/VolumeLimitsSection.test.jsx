import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { VolumeLimitsSection } from "./VolumeLimitsSection.jsx";

function mkSlot(overrides = {}) {
  return {
    slot: 1,
    color: 'red',
    class: 'private',
    mac: 'aa:bb',
    volume: { default: 50, min: 0, max: 75 },
    ...overrides,
  };
}

function renderSection(props) {
  return render(
    <MantineProvider>
      <VolumeLimitsSection {...props} />
    </MantineProvider>
  );
}

describe('VolumeLimitsSection', () => {
  let mutations;

  beforeEach(() => {
    mutations = {
      updateDevice: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('renders three inputs reflecting slot.volume.{default,min,max}', () => {
    renderSection({ slot: mkSlot(), mutations });

    const defaultInput = screen.getByLabelText(/default/i);
    const minInput = screen.getByLabelText(/^min$/i);
    const maxInput = screen.getByLabelText(/^max$/i);

    expect(defaultInput).toHaveValue('50');
    expect(minInput).toHaveValue('0');
    expect(maxInput).toHaveValue('75');
  });

  it('Save is disabled when no field has changed', () => {
    renderSection({ slot: mkSlot(), mutations });
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
  });

  it('blocks invalid bounds until corrected, then saves the valid patch', async () => {
    renderSection({ slot: mkSlot(), mutations });

    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '30' } });

    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Min ≤ Default ≤ Max');
    fireEvent.click(save);
    expect(mutations.updateDevice).not.toHaveBeenCalled();

    fireEvent.change(maxInput, { target: { value: '60' } });
    expect(save).not.toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      fireEvent.click(save);
    });

    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      volume: { default: 50, min: 0, max: 60 },
    });
  });

  it('re-disables Save after successful save (form re-baselines)', async () => {
    renderSection({ slot: mkSlot(), mutations });

    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '60' } });

    const save = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.click(save);
    });

    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', { volume: { default: 50, min: 0, max: 60 } });
    // After save resolves, the form's baseline is the new value, so dirty=false
    expect(save).toBeDisabled();
  });

  it('preserves a newer draft when the saved volume refresh arrives', async () => {
    let resolveSave;
    mutations.updateDevice = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }))
      .mockResolvedValueOnce({ ok: true });
    const view = renderSection({ slot: mkSlot(), mutations });
    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '80' } });
    const save = screen.getByRole('button', { name: /save/i });
    await act(async () => { fireEvent.click(save); });
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      volume: { default: 50, min: 0, max: 80 },
    });

    fireEvent.change(maxInput, { target: { value: '85' } });
    await act(async () => {
      view.rerender(<MantineProvider><VolumeLimitsSection slot={mkSlot({ volume: { default: 50, min: 0, max: 80 } })} mutations={mutations} /></MantineProvider>);
    });
    expect(maxInput).toHaveValue('85');

    await act(async () => { resolveSave({ ok: true }); });
    expect(maxInput).toHaveValue('85');
    expect(save).toBeEnabled();
    await act(async () => { fireEvent.click(save); });
    expect(mutations.updateDevice).toHaveBeenNthCalledWith(2, 'red', {
      volume: { default: 50, min: 0, max: 85 },
    });
  });

  it('keeps a newer external value when an older save resolves late', async () => {
    let resolveSave;
    mutations.updateDevice = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
    const view = renderSection({ slot: mkSlot(), mutations });
    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '80' } });
    const save = screen.getByRole('button', { name: /save/i });
    await act(async () => { fireEvent.click(save); });

    await act(async () => {
      view.rerender(<MantineProvider><VolumeLimitsSection slot={mkSlot({ volume: { default: 50, min: 0, max: 80 } })} mutations={mutations} /></MantineProvider>);
    });
    await act(async () => {
      view.rerender(<MantineProvider><VolumeLimitsSection slot={mkSlot({ volume: { default: 50, min: 0, max: 90 } })} mutations={mutations} /></MantineProvider>);
    });

    await act(async () => { resolveSave({ ok: true }); });
    expect(maxInput).toHaveValue('90');
    expect(save).toBeDisabled();

    fireEvent.change(maxInput, { target: { value: '80' } });
    expect(save).toBeEnabled();
  });

  it('uses the shared default bounds when slot.volume is missing', () => {
    renderSection({ slot: mkSlot({ volume: undefined }), mutations });
    expect(screen.getByLabelText(/default/i)).toHaveValue('60');
    expect(screen.getByLabelText(/^min$/i)).toHaveValue('0');
    expect(screen.getByLabelText(/^max$/i)).toHaveValue('100');
  });

  it('resolves sparse server bounds using the same defaults and allows a valid edit', async () => {
    renderSection({ slot: mkSlot({ volume: { min: 10, max: 75 } }), mutations });
    expect(screen.getByLabelText(/default/i)).toHaveValue('60');
    expect(screen.getByLabelText(/^min$/i)).toHaveValue('10');
    expect(screen.getByLabelText(/^max$/i)).toHaveValue('75');

    fireEvent.change(screen.getByLabelText(/^max$/i), { target: { value: '80' } });
    const save = screen.getByRole('button', { name: /save/i });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save).not.toBeDisabled();
    await act(async () => fireEvent.click(save));
    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', { volume: { default: 60, min: 10, max: 80 } });
  });

  it('does NOT rebaseline when updateDevice returns { ok: false }', async () => {
    mutations.updateDevice = vi.fn().mockResolvedValue({
      ok: false,
      error: new Error('HTTP 422: invariant violated'),
    });

    renderSection({ slot: mkSlot(), mutations });

    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '80' } });

    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // After failure: Save should STILL be enabled (dirty state preserved).
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });
});
