import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
vi.mock('./GovernanceAudioPlayer.jsx', () => ({ default: () => null }));
import GovernanceStateOverlay from './GovernanceStateOverlay.jsx';
import { resolveGovernanceDisplay } from '../../hooks/useGovernanceDisplay.js';
const row = (overrides = {}) => ({
  key: overrides.userId || 'rider-a', userId: 'rider-a', displayName: 'Rider A', avatarSrc: '', heartRate: 96, targetHeartRate: 110, progress: 0.5,
  currentZone: { id: 'cool', name: 'Cool', color: '#94a3b8' }, targetZone: { id: 'active', name: 'Active', color: '#22c55e' },
  status: 'missing', holdProgress: null, ...overrides,
});
const display = (rows, status = 'locked') => ({ show: true, status, videoLocked: status === 'locked', activeUserCount: rows.length,
  deadline: Date.now() + 30000, gracePeriodTotal: 30, requirements: [], rows });

describe('GovernanceStateOverlay — compact feedback', () => {
  it.each(['warning', 'locked'])('%s uses a pedal icon with accessible instruction in the existing measurement row', (status) => {
    const { container, getByLabelText } = render(<GovernanceStateOverlay display={display([row({ pedal: { rpm: 18.4, targetRpm: 30, orZoneLabel: 'Active' } })], status)} />);
    expect(getByLabelText('Pedal or reach Active')).toBeTruthy();
    expect(container.querySelector('.governance-pedal-icon svg')).toBeTruthy();
    expect(container.textContent).toContain('18 / 30');
    expect(container.textContent).not.toContain('RPM');
    expect(container.querySelector('[class$="__chip-hint"]')).toBeNull();
  });
  it('a pure cadence floor retains its accessible pedal instruction', () => {
    const { getByLabelText } = render(<GovernanceStateOverlay display={display([row({ pedal: { rpm: 0, targetRpm: 30 } })])} />);
    expect(getByLabelText('Start pedaling')).toBeTruthy();
  });
  it.each(['warning', 'locked'])('%s shows a personal secondary hold bar without Holding prose or an extra text row', (status) => {
    const { container, getByRole } = render(<GovernanceStateOverlay display={display([row({ status: 'holding', holdProgress: { elapsedMs: 4000, remainingMs: 6000, totalMs: 10000 } })], status)} />);
    const progress = getByRole('progressbar', { name: 'Rider A zone hold' });
    expect(progress.getAttribute('aria-valuenow')).toBe('4000');
    expect(progress.getAttribute('aria-valuemax')).toBe('10000');
    expect(progress.getAttribute('aria-valuetext')).toBe('6 seconds remaining');
    expect(container.textContent).not.toContain('Holding');
    expect(container.querySelector('.governance-start-badge')).toBeNull();
  });
  it('zero hold emits no secondary indicator', () => {
    const { queryByRole } = render(<GovernanceStateOverlay display={display([row({ holdProgress: { elapsedMs: 0, remainingMs: 0, totalMs: 0 } })])} />);
    expect(queryByRole('progressbar')).toBeNull();
  });
  it('heart-rate and pedal rows retain one shared grid with two identity text lines', () => {
    const { container } = render(<GovernanceStateOverlay display={display([row(), row({ userId: 'rider-b', pedal: { rpm: 0, targetRpm: 30 } })])} />);
    const rows = container.querySelectorAll('.governance-lock__row');
    expect(rows).toHaveLength(2);
    rows.forEach((r) => expect(r.querySelector('.governance-lock__chip-text').children).toHaveLength(2));
  });
});

describe('GovernanceStateOverlay — live current state and percentage', () => {
  it('updates live Cool at 96/110 and 101/110 after a prior Active snapshot', () => {
    const view = render(<GovernanceStateOverlay display={display([row({ currentZone: { id: 'active', name: 'Active' }, heartRate: 111 })])} />);
    for (const hr of [96, 101]) {
      view.rerender(<GovernanceStateOverlay display={display([row({ heartRate: hr })])} />);
      const current = view.container.querySelector('.governance-lock__pill:not(.governance-lock__pill--target)');
      expect(current.textContent).toBe('Cool');
      expect(current.classList.contains('zone-cool')).toBe(true);
      expect(view.container.querySelector('.governance-lock__avatar.zone-cool')).toBeTruthy();
      expect(view.container.querySelector('.governance-lock__pill--target.zone-active').textContent).toBe('Active');
      expect(view.container.querySelector('.governance-lock__chip-meta').textContent).toBe(`${hr} / 110`);
    }
  });
  it.each([[-0.1, '0%', '0%'], [0, '0%', '0%'], [0.5, '50%', '50%'], [1, '100%', '100%'], [1.1, '100%', '100%']])('bounds the %s percentage notch inside the bar', (value, label, left) => {
    const { container } = render(<GovernanceStateOverlay display={display([row({ progress: value })])} />);
    const marker = container.querySelector('.governance-lock__progress-indicator');
    expect(marker?.textContent).toBe(label);
    expect(marker?.style.left).toBe(left);
    expect(marker?.style.transform).toBe(`translateX(-${left})`);
  });
  it('updates the notch with HR progress independently from the secondary hold bar', () => {
    const view = render(<GovernanceStateOverlay display={display([row({ progress: 0.5 })])} />);
    view.rerender(<GovernanceStateOverlay display={display([row({ progress: 1, holdProgress: { elapsedMs: 4000, remainingMs: 6000, totalMs: 10000 } })])} />);
    expect(view.container.querySelector('.governance-lock__progress-indicator').textContent).toBe('100%');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4000');
  });
  it('removes completed blockers immediately when they join the credited faces', () => {
    const view = render(<GovernanceStateOverlay display={display([row()])} />);
    view.rerender(<GovernanceStateOverlay display={{ ...display([]), activeUserCount: 2, requirements: [{ requiredCount: 2, actualCount: 1, zoneLabel: 'Active' }], metRows: [row()] }} />);
    expect(view.container.querySelectorAll('.governance-lock__chip-name')).toHaveLength(0);
    expect(view.container.querySelectorAll('.governance-lock__credit--met')).toHaveLength(1);
  });
});

describe('GovernanceStateOverlay — cause-scoped heading and faces', () => {
  const zoneMeta = { map: Object.fromEntries(['cool', 'active', 'warm'].map((id, rank) => [id, { id, name: id[0].toUpperCase() + id.slice(1), rank }])) };
  const map = new Map(['a', 'b', 'c', 'd'].map((id) => [id, { displayName: `Rider ${id}`, heartRate: id === 'a' ? 105 : 120, zoneId: id === 'a' ? 'cool' : 'active', targetHeartRate: 110 }]));
  const floor = { zone: 'active', zoneLabel: 'Active', actualCount: 3, requiredCount: 4, satisfied: false, missingUsers: ['a'], metUsers: ['b', 'c', 'd'] };
  const challenge = { type: 'zone', id: 'challenge', zone: 'warm', zoneLabel: 'Warm', actualCount: 1, requiredCount: 2, missingUsers: ['a', 'b'], metUsers: ['c'], holding: ['b'] };
  it.each(['pending', 'failed'])('keeps 3 of 4 Active and only floor faces/rows over a %s Warm challenge', (status) => {
    const resolved = resolveGovernanceDisplay({ isGoverned: true, status: 'locked', activeUserCount: 4, requirements: [floor], challenge: { ...challenge, status } }, map, zoneMeta);
    const { container } = render(<GovernanceStateOverlay display={resolved} />);
    expect(container.querySelector('.governance-lock__summary-main').textContent).toBe('3 of 4 in Active');
    expect(container.querySelectorAll('.governance-lock__credit--met')).toHaveLength(3);
    expect(container.querySelectorAll('.governance-lock__row')).toHaveLength(1);
    expect(container.querySelector('.governance-lock__chip-meta').textContent).toBe('105 / 110');
    expect(container.textContent).not.toContain('Warm');
  });
  it('switches back to the same failed Warm challenge after floor recovery', () => {
    const resolve = (base) => resolveGovernanceDisplay({ isGoverned: true, status: 'locked', activeUserCount: 4, requirements: [base], challenge: { ...challenge, status: 'failed' } }, map, zoneMeta);
    const view = render(<GovernanceStateOverlay display={resolve(floor)} />);
    view.rerender(<GovernanceStateOverlay display={resolve({ ...floor, satisfied: true, missingUsers: [] })} />);
    expect(view.container.querySelector('.governance-lock__summary-main').textContent).toBe('1 of 2 in Warm');
    expect(view.container.querySelectorAll('.governance-lock__credit--met')).toHaveLength(1);
    expect(view.container.querySelectorAll('.governance-lock__row')).toHaveLength(2);
  });
});
