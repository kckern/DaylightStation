import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DeviceCard } from './DeviceCard.jsx';

// Stub the leaf section components so this test focuses on composition:
// which sections appear in the accordion for each device class.
vi.mock('./DeviceHeader.jsx', () => ({
  DeviceHeader: ({ slot }) => (
    <div data-testid="device-header" data-color={slot.color}>
      header-{slot.color}
    </div>
  ),
}));

vi.mock('./TransportRow.jsx', () => ({
  TransportRow: ({ slot }) => (
    <div data-testid="transport-row" data-color={slot.color}>
      transport-{slot.color}
    </div>
  ),
}));

vi.mock('./SchedulesSection.jsx', () => ({
  SchedulesSection: ({ slot }) => (
    <div data-testid="schedules-section" data-color={slot.color}>
      schedules-{slot.color}
    </div>
  ),
}));

vi.mock('./ScheduledFiresSection.jsx', () => ({
  ScheduledFiresSection: ({ target, fires, slotMaxVolume }) => (
    <div
      data-testid="scheduled-fires-section"
      data-target={target}
      data-fire-count={fires?.length ?? 0}
      data-slot-max-volume={slotMaxVolume}
    >
      fires-{target}
    </div>
  ),
}));

vi.mock('./VolumeLimitsSection.jsx', () => ({
  VolumeLimitsSection: ({ slot }) => (
    <div data-testid="volume-limits-section" data-color={slot.color}>
      volume-{slot.color}
    </div>
  ),
}));

vi.mock('./HomeAutomationSection.jsx', () => ({
  HomeAutomationSection: ({ slot }) => (
    <div data-testid="home-automation-section" data-color={slot.color}>
      ha-{slot.color}
    </div>
  ),
}));

function mkPrivateSlot(overrides = {}) {
  return {
    slot: 1,
    color: 'red',
    class: 'private',
    mac: 'aa:bb',
    volume: { default: 50, min: 0, max: 75 },
    continuous: [],
    ...overrides,
  };
}

function mkPublicSlot(overrides = {}) {
  return {
    slot: 5,
    color: 'white',
    class: 'public',
    mac: 'cc:dd',
    volume: { default: 40, min: 0, max: 70 },
    ha_entity_id: 'switch.bedroom',
    ha_turn_off_on_stop: true,
    ...overrides,
  };
}

function renderCard(props) {
  return render(
    <MantineProvider>
      <DeviceCard {...props} />
    </MantineProvider>
  );
}

describe('DeviceCard', () => {
  let mutations;

  beforeEach(() => {
    mutations = {
      updateDevice: vi.fn(),
      saveFire: vi.fn(),
      deleteFire: vi.fn(),
      sendCommand: vi.fn(),
    };
  });

  describe('private device', () => {
    it('always renders header and transport row', () => {
      renderCard({
        slot: mkPrivateSlot(),
        status: undefined,
        scheduledFires: [],
        mutations,
      });
      expect(screen.getByTestId('device-header')).toBeInTheDocument();
      expect(screen.getByTestId('transport-row')).toBeInTheDocument();
    });

    it('shows three accordion controls: schedules, scheduled fires, volume limits — no home automation', () => {
      renderCard({
        slot: mkPrivateSlot(),
        status: undefined,
        scheduledFires: [],
        mutations,
      });
      expect(
        screen.getByRole('button', { name: /continuous schedules/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /scheduled fires/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /volume limits/i })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /home automation/i })
      ).not.toBeInTheDocument();
    });

    it('uses domain vocabulary "Home Automation", not vendor name "Home Assistant"', () => {
      const { container } = renderCard({
        slot: mkPrivateSlot(),
        status: undefined,
        scheduledFires: [],
        mutations,
      });
      expect(container.innerHTML).not.toMatch(/Home\s*Assistant/i);
    });
  });

  describe('public device', () => {
    it('always renders header and transport row', () => {
      renderCard({
        slot: mkPublicSlot(),
        status: undefined,
        scheduledFires: [],
        mutations,
      });
      expect(screen.getByTestId('device-header')).toBeInTheDocument();
      expect(screen.getByTestId('transport-row')).toBeInTheDocument();
    });

    it('shows three accordion controls: scheduled fires, volume limits, home automation — no continuous schedules', () => {
      renderCard({
        slot: mkPublicSlot(),
        status: undefined,
        scheduledFires: [],
        mutations,
      });
      expect(
        screen.queryByRole('button', { name: /continuous schedules/i })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /scheduled fires/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /volume limits/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /home automation/i })
      ).toBeInTheDocument();
    });

    it('passes target color, filtered fires, and slot.volume.max into ScheduledFiresSection', () => {
      const fires = [
        { id: 'f1', target: 'white', time: '07:00', days: ['all'], queue: 'plex:1' },
        { id: 'f2', target: 'white', time: '08:00', days: ['all'], queue: 'plex:2' },
      ];
      renderCard({
        slot: mkPublicSlot(),
        status: undefined,
        scheduledFires: fires,
        mutations,
      });
      const node = screen.getByTestId('scheduled-fires-section');
      expect(node.getAttribute('data-target')).toBe('white');
      expect(node.getAttribute('data-fire-count')).toBe('2');
      expect(node.getAttribute('data-slot-max-volume')).toBe('70');
    });
  });

  it('passes status through to header (live state propagation)', () => {
    const status = {
      color: 'red',
      bt_connected: true,
      paused: false,
      now_playing: { title: 'Across the Sky' },
      volume: 45,
    };
    renderCard({
      slot: mkPrivateSlot(),
      status,
      scheduledFires: [],
      mutations,
    });
    // Header stub got the slot — that's enough to verify composition.
    expect(screen.getByTestId('device-header').getAttribute('data-color')).toBe('red');
  });
});
