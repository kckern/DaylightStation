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
    schedules: [
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

function expandWindow(n = 1) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`expand window ${n}`, 'i') })
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
    expandWindow(1);
    expect(screen.getAllByTestId(/picker-stub/).length).toBe(1);

    const startInputs = screen.getAllByLabelText(/start/i);
    expect(startInputs[0]).toHaveValue('07:00');
    const endInputs = screen.getAllByLabelText(/end/i);
    expect(endInputs[0]).toHaveValue('21:00');
  });

  it('renders empty state when slot has no schedules', () => {
    renderSection({ slot: mkSlot({ schedules: [] }), mutations });
    expect(screen.queryAllByTestId(/picker-stub/).length).toBe(0);
    expect(screen.getByRole('button', { name: /add window/i })).toBeInTheDocument();
  });

  it('Add window adds a new empty row', () => {
    renderSection({ slot: mkSlot({ schedules: [] }), mutations });
    fireEvent.click(screen.getByRole('button', { name: /add window/i }));
    expect(screen.getAllByTestId(/picker-stub/).length).toBe(1);
  });

  it('Remove removes a row', () => {
    renderSection({ slot: mkSlot(), mutations });
    expect(screen.getAllByRole('button', { name: /remove window/i }).length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /remove window 1/i }));
    expect(screen.queryAllByRole('button', { name: /remove window/i }).length).toBe(0);
  });

  it('Save calls updateDevice with the full updated continuous list', async () => {
    renderSection({ slot: mkSlot(), mutations });
    expandWindow(1);

    // Edit start time
    const startInputs = screen.getAllByLabelText(/start/i);
    fireEvent.change(startInputs[0], { target: { value: '08:00' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save schedules/i }));
    });

    expect(mutations.updateDevice).toHaveBeenCalledTimes(1);
    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      schedules: [
        { start: '08:00', end: '21:00', queue: 'plex:675465', shuffle: true },
      ],
    });
  });

  it('Save includes new rows added via Add window', async () => {
    renderSection({ slot: mkSlot({ schedules: [] }), mutations });

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
      schedules: [
        expect.objectContaining({
          start: '09:00',
          end: '17:00',
          queue: 'plex:111',
        }),
      ],
    });
  });

  it('renders existing windows as collapsed (summary visible, form hidden)', () => {
    renderSection({ slot: mkSlot(), mutations });
    // Summary row is visible
    expect(screen.getByText('07:00 – 21:00')).toBeInTheDocument();
    // Form inputs are NOT yet rendered
    expect(screen.queryByLabelText(/start/i)).toBeNull();
    expect(screen.queryByLabelText(/end/i)).toBeNull();
  });

  it('clicking expand chevron reveals the form', () => {
    renderSection({ slot: mkSlot(), mutations });
    fireEvent.click(screen.getByRole('button', { name: /expand window 1/i }));
    expect(screen.getByLabelText(/start/i)).toHaveValue('07:00');
    expect(screen.getByLabelText(/end/i)).toHaveValue('21:00');
  });

  it('newly added rows start expanded', () => {
    renderSection({ slot: mkSlot({ schedules: [] }), mutations });
    fireEvent.click(screen.getByRole('button', { name: /add window/i }));
    expect(screen.getByLabelText(/start/i)).toBeInTheDocument();
  });

  it('expanding, editing, and collapsing keeps the row expanded while dirty', () => {
    renderSection({ slot: mkSlot(), mutations });
    fireEvent.click(screen.getByRole('button', { name: /expand window 1/i }));
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: '08:00' } });

    // Attempt to collapse
    fireEvent.click(screen.getByRole('button', { name: /collapse window 1/i }));

    // Form should still be there — dirty wins
    expect(screen.getByLabelText(/start/i)).toHaveValue('08:00');
  });

  it('Shuffle switch toggles shuffle field in saved payload', async () => {
    renderSection({
      slot: mkSlot({
        schedules: [
          { start: '07:00', end: '21:00', queue: 'plex:1', shuffle: false },
        ],
      }),
      mutations,
    });
    expandWindow(1);

    const shuffleSwitch = screen.getByRole('switch', { name: /shuffle/i });
    fireEvent.click(shuffleSwitch);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save schedules/i }));
    });

    expect(mutations.updateDevice).toHaveBeenCalledWith('red', {
      schedules: [
        expect.objectContaining({ shuffle: true }),
      ],
    });
  });
});
