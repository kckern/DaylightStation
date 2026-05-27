import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { HomeAssistantSection } from './HomeAssistantSection.jsx';

function mkSlot(overrides = {}) {
  return {
    slot: 5,
    color: 'white',
    class: 'public',
    mac: 'aa:bb',
    ha_entity_id: 'switch.bedroom',
    ha_turn_off_on_stop: false,
    volume: { default: 40, min: 0, max: 70 },
    ...overrides,
  };
}

function renderSection(props) {
  return render(
    <MantineProvider>
      <HomeAssistantSection {...props} />
    </MantineProvider>
  );
}

describe('HomeAssistantSection', () => {
  let mutations;

  beforeEach(() => {
    mutations = {
      updateDevice: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('renders existing ha_entity_id and ha_turn_off_on_stop values', () => {
    renderSection({ slot: mkSlot(), mutations });
    expect(screen.getByLabelText(/entity id/i)).toHaveValue('switch.bedroom');
    expect(screen.getByRole('switch', { name: /turn off entity when playback stops/i })).not.toBeChecked();
  });

  it('renders empty string when ha_entity_id is missing', () => {
    renderSection({
      slot: mkSlot({ ha_entity_id: undefined }),
      mutations,
    });
    expect(screen.getByLabelText(/entity id/i)).toHaveValue('');
  });

  it('Save calls updateDevice with camelCase haEntityId + haTurnOffOnStop', async () => {
    renderSection({ slot: mkSlot(), mutations });

    const entityInput = screen.getByLabelText(/entity id/i);
    fireEvent.change(entityInput, { target: { value: 'switch.living_room' } });

    const turnOffSwitch = screen.getByRole('switch', { name: /turn off entity when playback stops/i });
    fireEvent.click(turnOffSwitch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
    });

    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('white', {
      haEntityId: 'switch.living_room',
      haTurnOffOnStop: true,
    });
  });

  it('Save is disabled until the form is dirty', () => {
    renderSection({ slot: mkSlot(), mutations });
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
  });

  it('refuses to save when haEntityId is empty for public class', async () => {
    renderSection({ slot: mkSlot(), mutations });

    const entityInput = screen.getByLabelText(/entity id/i);
    fireEvent.change(entityInput, { target: { value: '' } });

    // Save should be disabled OR clicking shows an error
    const save = screen.getByRole('button', { name: /save/i });

    // Either it's disabled, or the click is rejected
    if (!save.hasAttribute('disabled')) {
      await act(async () => {
        fireEvent.click(save);
      });
      // No mutation should have been called
      expect(mutations.updateDevice).not.toHaveBeenCalled();
      expect(screen.getByText(/required/i)).toBeInTheDocument();
    } else {
      // Disabled state — also valid
      expect(save).toBeDisabled();
    }
  });

  it('allows empty haEntityId when class is private (no warning)', async () => {
    renderSection({
      slot: mkSlot({ class: 'private', ha_entity_id: 'switch.foo' }),
      mutations,
    });

    const entityInput = screen.getByLabelText(/entity id/i);
    fireEvent.change(entityInput, { target: { value: '' } });

    const save = screen.getByRole('button', { name: /save/i });
    expect(save).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(save);
    });

    expect(mutations.updateDevice).toHaveBeenCalledWith('white', {
      haEntityId: '',
      haTurnOffOnStop: false,
    });
  });
});
