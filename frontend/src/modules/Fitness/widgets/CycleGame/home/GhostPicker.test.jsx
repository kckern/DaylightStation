import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { GhostPicker } from './GhostPicker.jsx';

const soloRace = {
  raceId: 'R1',
  day: '2026-06-06',
  timeOfDay: '08:00',
  goalLabel: 'Solo race',
  winCondition: 'distance',
  participants: [{ id: 'kckern', displayName: 'KC', isGhost: false, avatarSrc: '' }]
};
const multiRace = {
  raceId: 'R2',
  day: '2026-06-06',
  timeOfDay: '09:00',
  goalLabel: 'Multi race',
  winCondition: 'distance',
  participants: [
    { id: 'kckern', displayName: 'KC', isGhost: false, avatarSrc: '' },
    { id: 'felix', displayName: 'Felix', isGhost: false, avatarSrc: '' }
  ]
};

describe('GhostPicker single-rider skip', () => {
  it('commits directly (no roster) when a race has one live rider', () => {
    cleanup();
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <GhostPicker candidates={[soloRace]} onSelect={onSelect} onClear={() => {}} onClose={() => {}} />
    );
    const card = getByTestId('ghost-R1');
    fireEvent.click(card); // focus
    fireEvent.click(card); // commit
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].participants).toHaveLength(1);
    expect(onSelect.mock.calls[0][0].participants[0].id).toBe('kckern');
  });

  it('opens the roster (does not auto-commit) for a multi-rider race', () => {
    cleanup();
    const onSelect = vi.fn();
    const { getByTestId } = render(
      <GhostPicker candidates={[multiRace]} onSelect={onSelect} onClear={() => {}} onClose={() => {}} />
    );
    const card = getByTestId('ghost-R2');
    fireEvent.click(card); // focus
    fireEvent.click(card); // second click — should open roster, NOT call onSelect
    expect(onSelect).not.toHaveBeenCalled();
  });
});
