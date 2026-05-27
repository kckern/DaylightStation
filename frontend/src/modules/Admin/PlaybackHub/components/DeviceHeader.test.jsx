import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DeviceHeader } from './DeviceHeader.jsx';

function renderHeader(props) {
  return render(
    <MantineProvider>
      <DeviceHeader {...props} />
    </MantineProvider>
  );
}

const baseSlot = {
  slot: 1,
  color: 'red',
  name: 'musiCozy',
  class: 'private',
  mac: '41:42:3A:E5:43:07',
  volume: { default: 50, min: 0, max: 75 },
};

const baseStatus = {
  position: 1,
  color: 'red',
  bt_connected: true,
  paused: false,
  now_playing: {
    queue: { source: 'plex', id: '670208' },
    title: 'Across the Sky',
  },
  volume: 45,
  playlist_pos: 3,
  playlist_count: 12,
  armed_source: null,
};

describe('DeviceHeader', () => {
  it('renders color, name, class badge, BT-on, now-playing title and "vol N/MAX"', () => {
    renderHeader({ slot: baseSlot, status: baseStatus });

    expect(screen.getByText('red')).toBeInTheDocument();
    expect(screen.getByText('musiCozy')).toBeInTheDocument();
    expect(screen.getByText(/private/i)).toBeInTheDocument();
    expect(screen.getByText(/BT/i)).toBeInTheDocument();
    expect(screen.getByText('Across the Sky')).toBeInTheDocument();
    expect(screen.getByText('45/75')).toBeInTheDocument();
  });

  it('renders idle state when status is undefined', () => {
    renderHeader({ slot: baseSlot, status: undefined });

    expect(screen.getByText('red')).toBeInTheDocument();
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
  });

  it('renders idle state when now_playing is null', () => {
    renderHeader({
      slot: baseSlot,
      status: { ...baseStatus, now_playing: null },
    });
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
  });

  it('shows BT-off indicator when bt_connected is false', () => {
    renderHeader({
      slot: baseSlot,
      status: { ...baseStatus, bt_connected: false },
    });
    // The component should render some "BT ✗" or "disconnected" marker.
    const btText = screen.getByText(/BT/i).textContent;
    // Should include something other than the connected glyph
    expect(btText).toMatch(/✗|off|disconnected/i);
  });

  it('shows a paused indicator when status.paused is true', () => {
    renderHeader({
      slot: baseSlot,
      status: { ...baseStatus, paused: true },
    });
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it('renders class badge "public" for public devices', () => {
    renderHeader({
      slot: { ...baseSlot, class: 'public', ha_entity_id: 'switch.light' },
      status: baseStatus,
    });
    expect(screen.getByText(/public/i)).toBeInTheDocument();
  });

  it('falls back to slot.volume.default when status.volume is missing', () => {
    renderHeader({
      slot: baseSlot,
      status: { ...baseStatus, volume: undefined },
    });
    // default is 50, max is 75
    expect(screen.getByText('50/75')).toBeInTheDocument();
  });
});
