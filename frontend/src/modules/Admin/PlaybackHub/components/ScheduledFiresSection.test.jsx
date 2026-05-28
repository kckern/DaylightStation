import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { ScheduledFiresSection } from './ScheduledFiresSection.jsx';

// Stub LabeledContentPicker
let pickerOnChangeRefs = [];
vi.mock('./LabeledContentPicker.jsx', () => ({
  LabeledContentPicker: function PickerStub({ value, onChange }) {
    const idx = pickerOnChangeRefs.length;
    pickerOnChangeRefs.push(onChange);
    return (
      <input
        data-testid={`picker-stub-${idx}`}
        data-value={value || ''}
        readOnly
      />
    );
  },
}));

function renderSection(props) {
  return render(
    <MantineProvider>
      <ScheduledFiresSection {...props} />
    </MantineProvider>
  );
}

function expandFire(n = 1) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`expand fire ${n}`, 'i') })
  );
}

describe('ScheduledFiresSection', () => {
  let mutations;

  beforeEach(() => {
    pickerOnChangeRefs = [];
    mutations = {
      saveFire: vi.fn().mockResolvedValue({ ok: true }),
      deleteFire: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('renders existing fires (filtered for target)', () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
          duration_min: 30,
          volume_override: 50,
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    expandFire(1);
    expect(screen.getAllByLabelText(/time/i)[0]).toHaveValue('07:00');
    expect(screen.getAllByTestId(/picker-stub/).length).toBe(1);
  });

  it('renders empty state when no fires', () => {
    renderSection({
      target: 'red',
      fires: [],
      slotMaxVolume: 75,
      mutations,
    });
    expect(screen.queryAllByTestId(/picker-stub/).length).toBe(0);
    expect(screen.getByRole('button', { name: /add fire/i })).toBeInTheDocument();
  });

  it('"Indefinite" checkbox disables the duration NumberInput', () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
          duration_min: 30,
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    expandFire(1);
    const indefiniteBox = screen.getByLabelText(/indefinite/i);
    const durationInput = screen.getByLabelText(/duration/i);

    expect(durationInput).not.toBeDisabled();
    fireEvent.click(indefiniteBox);
    expect(durationInput).toBeDisabled();
  });

  it('Save new fire calls saveFire with an id (client-generated)', async () => {
    renderSection({
      target: 'red',
      fires: [],
      slotMaxVolume: 75,
      mutations,
    });

    fireEvent.click(screen.getByRole('button', { name: /add fire/i }));

    const timeInputs = screen.getAllByLabelText(/time/i);
    fireEvent.change(timeInputs[0], { target: { value: '08:30' } });

    act(() => {
      pickerOnChangeRefs[0]('plex:111');
    });

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /save fire/i })[0]);
    });

    expect(mutations.saveFire).toHaveBeenCalledTimes(1);
    const payload = mutations.saveFire.mock.calls[0][0];
    expect(payload.id).toBeDefined();
    expect(payload.id).not.toBe('');
    expect(payload.time).toBe('08:30');
    expect(payload.target).toBe('red');
    expect(payload.queue).toBe('plex:111');
  });

  it('Save existing fire keeps the same id', async () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-existing',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
          duration_min: 30,
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    expandFire(1);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /save fire/i })[0]);
    });

    expect(mutations.saveFire).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fire-existing' })
    );
  });

  it('Save converts wire snake_case duration_min/volume_override to camelCase', async () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
          duration_min: 30,
          volume_override: 50,
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    expandFire(1);
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /save fire/i })[0]);
    });

    const payload = mutations.saveFire.mock.calls[0][0];
    expect(payload.durationMin).toBe(30);
    expect(payload.volumeOverride).toBe(50);
    // Should NOT have the snake_case keys
    expect(payload.duration_min).toBeUndefined();
    expect(payload.volume_override).toBeUndefined();
  });

  it('Save with Indefinite checked sends durationMin: null', async () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
          duration_min: 30,
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    expandFire(1);
    fireEvent.click(screen.getByLabelText(/indefinite/i));

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /save fire/i })[0]);
    });

    expect(mutations.saveFire).toHaveBeenCalledWith(
      expect.objectContaining({ durationMin: null })
    );
  });

  it('Delete fires confirm modal then deleteFire on confirm', async () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    fireEvent.click(screen.getByRole('button', { name: /delete fire 1/i }));

    // Confirm modal should appear
    const confirmBtn = await screen.findByRole('button', { name: /^delete$/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    expect(mutations.deleteFire).toHaveBeenCalledWith('fire-1');
  });

  it('does NOT mark a new fire as saved when saveFire returns { ok: false }', async () => {
    mutations.saveFire = vi.fn().mockResolvedValue({
      ok: false,
      error: new Error('HTTP 400: invalid time'),
    });

    renderSection({
      target: 'red',
      fires: [],
      slotMaxVolume: 75,
      mutations,
    });

    fireEvent.click(screen.getByRole('button', { name: /^add fire$/i }));

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /^save fire$/i })[0]);
    });

    // After failed save: the row's trash icon must still say "Remove (not yet saved)",
    // NOT "Delete fire" — meaning the row never got promoted to a saved fire.
    const removeButton = screen.getByRole('button', { name: /delete fire 1/i });
    expect(removeButton.getAttribute('title')).toMatch(/not yet saved/i);
    expect(mutations.saveFire).toHaveBeenCalledTimes(1);
  });

  it('does NOT close the confirm modal when deleteFire returns { ok: false }', async () => {
    mutations.deleteFire = vi.fn().mockResolvedValue({
      ok: false,
      error: new Error('HTTP 404'),
    });

    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
        },
      ],
      slotMaxVolume: 75,
      mutations,
    });

    fireEvent.click(screen.getByRole('button', { name: /delete fire 1/i }));

    const confirmBtn = await screen.findByRole('button', { name: /^delete$/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // Modal stays open — title still visible.
    expect(screen.queryByText(/delete scheduled fire/i)).toBeTruthy();
  });

  it('Volume override NumberInput clamps to slotMaxVolume when typing an excessive value', async () => {
    renderSection({
      target: 'red',
      fires: [
        {
          id: 'fire-1',
          time: '07:00',
          days: 'weekdays',
          target: 'red',
          queue: 'plex:670208',
        },
      ],
      slotMaxVolume: 30,
      mutations,
    });

    expandFire(1);
    const volInput = screen.getByLabelText(/volume override/i);

    // Type a value above the max and blur to commit
    fireEvent.change(volInput, { target: { value: '99' } });
    fireEvent.blur(volInput);

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /save fire/i })[0]);
    });

    // Saved value should not exceed the slotMaxVolume
    const payload = mutations.saveFire.mock.calls[0][0];
    expect(payload.volumeOverride).toBeLessThanOrEqual(30);
  });

  it('renders existing fires as collapsed (summary visible, form hidden)', () => {
    renderSection({
      target: 'red',
      fires: [{
        id: 'fire-1', time: '07:30', days: 'weekdays',
        target: 'red', queue: 'plex:670208', duration_min: 30,
      }],
      slotMaxVolume: 75,
      mutations,
    });
    expect(screen.getByText('07:30')).toBeInTheDocument();
    expect(screen.queryByLabelText(/time/i)).toBeNull();
    expect(screen.queryByLabelText(/duration/i)).toBeNull();
  });

  it('clicking expand chevron reveals the fire form', () => {
    renderSection({
      target: 'red',
      fires: [{
        id: 'fire-1', time: '07:30', days: 'weekdays',
        target: 'red', queue: 'plex:670208', duration_min: 30,
      }],
      slotMaxVolume: 75,
      mutations,
    });
    fireEvent.click(screen.getByRole('button', { name: /expand fire 1/i }));
    expect(screen.getByLabelText(/time/i)).toHaveValue('07:30');
    expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
  });

  it('newly added fire starts expanded', () => {
    renderSection({ target: 'red', fires: [], slotMaxVolume: 75, mutations });
    fireEvent.click(screen.getByRole('button', { name: /add fire/i }));
    expect(screen.getByLabelText(/time/i)).toBeInTheDocument();
  });

  it('dirty fire row stays expanded after attempted collapse', () => {
    renderSection({
      target: 'red',
      fires: [{
        id: 'fire-1', time: '07:30', days: 'weekdays',
        target: 'red', queue: 'plex:670208', duration_min: 30,
      }],
      slotMaxVolume: 75,
      mutations,
    });
    fireEvent.click(screen.getByRole('button', { name: /expand fire 1/i }));
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '08:00' } });
    fireEvent.click(screen.getByRole('button', { name: /collapse fire 1/i }));
    expect(screen.getByLabelText(/time/i)).toHaveValue('08:00');
  });
});
