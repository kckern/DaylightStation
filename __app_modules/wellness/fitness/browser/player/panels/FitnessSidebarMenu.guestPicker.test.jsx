import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const ctx = { value: {} };
const events = [];
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => ctx.value }));
vi.mock('@/modules/Feedback/FeedbackOverlay.jsx', () => ({ default: () => null }));
vi.mock('@/lib/logging/Logger.js', () => {
  const make = (context = {}) => ({
    child: (c) => make({ ...context, ...c }),
    debug: (e, d) => events.push({ level: 'debug', e, d, context }),
    info: (e, d) => events.push({ level: 'info', e, d, context }),
    warn: (e, d) => events.push({ level: 'warn', e, d, context }),
    error: (e, d) => events.push({ level: 'error', e, d, context }),
    sampled: () => {},
  });
  const root = make();
  return { default: () => root, getLogger: () => root };
});

import FitnessSidebarMenu from './FitnessSidebarMenu.jsx';
import { buildGuestCandidates } from '../../lib/guestOptionsBuilder.js';

afterEach(() => { ctx.value = {}; events.length = 0; });

const usersConfig = {
  primary: [{ id: 'rider_m', name: 'Rider M' }, { id: 'rider_f', name: 'Rider F' }],
  family: [],
  friends: [],
};

function renderPicker({ assigned = true } = {}) {
  const assignGuestToDevice = vi.fn();
  const guestAssignment = assigned
    ? { deviceId: '10266', occupantId: 'guest_10266', occupantName: 'Guest', metadata: { candidateId: 'guest', profileId: 'guest_10266' } }
    : null;
  ctx.value = {
    deviceAssignments: guestAssignment ? [guestAssignment] : [],
    getDeviceAssignment: (id) => (id === '10266' ? guestAssignment : null),
    activeHeartRateParticipants: [{ id: 'rider_f', name: 'Rider F', isActive: true }],
    getUserByDevice: () => null,
    fitnessConfiguration: {},
  };
  const onClose = vi.fn();
  render(
    <FitnessSidebarMenu
      mode="guest"
      targetDeviceId="10266"
      onClose={onClose}
      visibility={{}}
      onToggleVisibility={vi.fn()}
      setBoost={vi.fn()}
      playerRef={{ current: { getMediaElement: () => null } }}
      videoVolume={{ volume: 0.5, setVolume: vi.fn() }}
      assignGuestToDevice={assignGuestToDevice}
      guestCandidates={buildGuestCandidates({ usersConfig })}
    />
  );
  return { assignGuestToDevice, onClose };
}

describe('guest picker — household members on an unowned strap', () => {
  it('logs guest_picker.opened with the Family options, offering the primary whose strap is not live', () => {
    renderPicker();
    const opened = events.filter((x) => x.e === 'guest_picker.opened');
    expect(opened).toHaveLength(1);
    expect(opened[0].context).toMatchObject({ component: 'fitness-guest-picker' });
    expect(opened[0].d).toMatchObject({ deviceId: '10266', occupantId: 'guest_10266' });
    expect(opened[0].d.family).toContain('rider_m');
    expect(opened[0].d.family).not.toContain('rider_f');
    expect(opened[0].d.excludedLive).toEqual(['rider_f']);
  });

  it('assigns the primary onto the strap and logs guest_picker.selected', () => {
    const { assignGuestToDevice } = renderPicker();
    fireEvent.click(screen.getByText('Rider M'));
    expect(assignGuestToDevice).toHaveBeenCalledWith('10266', expect.objectContaining({ profileId: 'rider_m', name: 'Rider M', occupantType: 'member' }));
    const selected = events.filter((x) => x.e === 'guest_picker.selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].d).toMatchObject({ deviceId: '10266', from: 'guest_10266', to: 'rider_m', isPrimary: true, tab: 'family', occupantType: 'member' });
  });

  it('a generic Guest pick stays typed as a guest', () => {
    const { assignGuestToDevice } = renderPicker({ assigned: false });
    fireEvent.click(screen.getAllByText('Guest')[0]);
    expect(assignGuestToDevice).toHaveBeenCalledWith('10266', expect.objectContaining({ occupantType: 'guest' }));
  });
});
