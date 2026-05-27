import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { SchedulesSection } from './SchedulesSection.jsx';

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

function mkSlot(overrides = {}) {
  return {
    slot: 1,
    color: 'red',
    class: 'private',
    mac: 'aa:bb',
    volume: { default: 50, min: 0, max: 75 },
    continuous: [
      { start: '07:00', end: '21:00', queue: 'plex:675465', shuffle: true },
    ],
    ...overrides,
  };
}

function renderSection(props) {
  return render(
    <MantineProvider>
      <SchedulesSection {...props} />
    </MantineProvider>
  );
}

describe('SchedulesSection', () => {
  let mutations;

  beforeEach(() => {
    pickerOnChangeRefs = [];
    mutations = {
      updateDevice: vi.fn().mockResolvedValue({ ok: true }),
    };
  });

  it('renders existing windows with start/end/queue/shuffle', () => {
    renderSection({ slot: mkSlot(), mutations });
    expect(screen.getAllByTestId(/picker-stub/).length).toBe(1);

    const startInputs = screen.getAllByLabelText(/start/i);
    expect(startInputs[0]).toHaveValue('07:00');
    const endInputs = screen.getAllByLabelText(/end/i);
    expect(endInputs[0]).toHaveValue('21:00');
  });

  it('renders empty state when slot has no continuous schedules', () => {
    renderSection({ slot: mkSlot({ continuous: [] }), mutations });
    expect(screen.queryAllByTestId(/picker-stub/).length).toBe(0);
    expect(screen.getByRole('button', { name: /add window/i })).toBeInTheDocument();
  });

  it('Add window adds a new empty row', () => {
    renderSection({ slot: mkSlot({ continuous: [] }), mutations });
    fireEvent.click(screen.getByRole('button', { name: /add window/i }));
    expect(screen.getAllByTestId(/picker-stub/).length).toBe(1);
  });

  it('Remove removes a row', () => {
    renderSection({ slot: mkSlot(), mutations });
    expect(screen.getAllByTestId(/picker-stub/).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /remove window 1/i }));
    expect(screen.queryAllByTestId(/picker-stub/).length).toBe(0);
  });

  it('Save calls updateDevice with the full updated continuous list', async () => {
    renderSection({ slot: mkSlot(), mutations });

    // Edit start time
    const startInputs = screen.getAllByLabelText(/start/i);
    fireEvent.change(startInputs[0], { target: { value: '08:00' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save schedules/i }));
    });

    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      continuous: [
        { start: '08:00', end: '21:00', queue: 'plex:675465', shuffle: true },
      ],
    });
  });

  it('Save includes new rows added via Add window', async () => {
    renderSection({ slot: mkSlot({ continuous: [] }), mutations });

    fireEvent.click(screen.getByRole('button', { name: /add window/i }));

    // Set times on the new row
    const startInputs = screen.getAllByLabelText(/start/i);
    fireEvent.change(startInputs[0], { target: { value: '09:00' } });
    const endInputs = screen.getAllByLabelText(/end/i);
    fireEvent.change(endInputs[0], { target: { value: '17:00' } });

    // Pick a queue via picker
    act(() => {
      pickerOnChangeRefs[0]('plex:111');
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save schedules/i }));
    });

    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      continuous: [
        expect.objectContaining({
          start: '09:00',
          end: '17:00',
          queue: 'plex:111',
        }),
      ],
    });
  });

  it('Shuffle switch toggles shuffle field in saved payload', async () => {
    renderSection({
      slot: mkSlot({
        continuous: [
          { start: '07:00', end: '21:00', queue: 'plex:1', shuffle: false },
        ],
      }),
      mutations,
    });

    const shuffleSwitch = screen.getByRole('switch', { name: /shuffle/i });
    fireEvent.click(shuffleSwitch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save schedules/i }));
    });

    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      continuous: [
        expect.objectContaining({ shuffle: true }),
      ],
    });
  });
});
