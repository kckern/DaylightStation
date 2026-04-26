import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => ({
    deviceAssignments: [],
    getDeviceAssignment: () => null,
    activeHeartRateParticipants: [],
    plexConfig: { music_playlists: [] },
    suppressDeviceUntilNextReading: null,
    getUserByDevice: () => null,
    getUserByName: () => null,
  }),
}));

vi.mock('@/lib/api.mjs', () => ({
  DaylightMediaPath: (p) => p,
}));

vi.mock(
  '#frontend/modules/Fitness/player/panels/TouchVolumeButtons.jsx',
  () => ({
    TouchVolumeButtons: ({ onSelect }) => (
      <button type="button" data-testid="touch-volume-stub" onClick={() => onSelect?.(3)}>
        volume stub
      </button>
    ),
    snapToTouchLevel: (v) => v,
    linearVolumeFromLevel: (v) => v,
    linearLevelFromVolume: (v) => v,
  })
);

import FitnessSidebarMenu from '#frontend/modules/Fitness/player/panels/FitnessSidebarMenu.jsx';

describe('FitnessSidebarMenu — idle close timer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); cleanup(); });

  function renderMenu(extraProps = {}) {
    const onClose = vi.fn();
    const utils = render(
      <FitnessSidebarMenu
        onClose={onClose}
        visibility={{ sidebarCam: false, treasureBox: false }}
        onToggleVisibility={() => {}}
        musicEnabled={false}
        onToggleMusic={() => {}}
        showChart
        onToggleChart={() => {}}
        boostLevel={1}
        setBoost={() => {}}
        videoVolume={{ volume: 0.5, setVolume: () => {}, applyToPlayer: () => {} }}
        {...extraProps}
      />
    );
    return { ...utils, onClose };
  }

  it('closes after 5 seconds of idle following a selection', () => {
    const { getByText, onClose } = renderMenu();
    fireEvent.pointerDown(getByText('📹 Sidebar Webcam').closest('.menu-item'));
    vi.advanceTimersByTime(400);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4600);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the 5s timer on subsequent pointer interactions', () => {
    const { getByText, container, onClose } = renderMenu();
    fireEvent.pointerDown(getByText('📹 Sidebar Webcam').closest('.menu-item'));
    vi.advanceTimersByTime(4000);
    const root = container.querySelector('.fitness-sidebar-menu');
    fireEvent.pointerDown(root);
    vi.advanceTimersByTime(500);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4400);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on keydown inside the menu', () => {
    const { getByText, container, onClose } = renderMenu();
    fireEvent.pointerDown(getByText('📹 Sidebar Webcam').closest('.menu-item'));
    vi.advanceTimersByTime(4000);
    const root = container.querySelector('.fitness-sidebar-menu');
    fireEvent.keyDown(root, { key: 'ArrowDown' });
    vi.advanceTimersByTime(4999);
    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a close when the menu is merely rendered (no interaction)', () => {
    const { onClose } = renderMenu();
    vi.advanceTimersByTime(10000);
    expect(onClose).not.toHaveBeenCalled();
  });
});
