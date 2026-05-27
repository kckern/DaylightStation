import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { VolumeLimitsSection } from './VolumeLimitsSection.jsx';

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

  it('enabling Save after editing, then clicking, calls updateDevice with the patch', async () => {
    renderSection({ slot: mkSlot(), mutations });

    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '30' } });

    const save = screen.getByRole('button', { name: /save/i });
    expect(save).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(save);
    });

    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      volume: { default: 50, min: 0, max: 30 },
    });
  });

  it('re-disables Save after successful save (form re-baselines)', async () => {
    renderSection({ slot: mkSlot(), mutations });

    const maxInput = screen.getByLabelText(/^max$/i);
    fireEvent.change(maxInput, { target: { value: '30' } });

    const save = screen.getByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.click(save);
    });

    // After save resolves, the form's baseline is the new value, so dirty=false
    expect(save).toBeDisabled();
  });

  it('handles slot.volume missing entirely (defaults to 0)', () => {
    renderSection({ slot: mkSlot({ volume: undefined }), mutations });
    const defaultInput = screen.getByLabelText(/default/i);
    expect(defaultInput).toHaveValue('0');
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
