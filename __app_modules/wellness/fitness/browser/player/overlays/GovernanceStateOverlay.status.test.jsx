import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
vi.mock('./GovernanceAudioPlayer.jsx', () => ({ default: () => null }));
import GovernanceStateOverlay from './GovernanceStateOverlay.jsx';
import { resolveGovernanceDisplay, groupRidersByGoal } from '../../hooks/useGovernanceDisplay.js';
const COOL = '#94a3b8';
const SEQUENCE = [{ id: 'cool', threshold: 60 }, { id: 'active', threshold: 110 }];
const row = (overrides = {}) => ({
  key: overrides.userId || 'rider-a', userId: 'rider-a', displayName: 'Rider A', avatarSrc: '', heartRate: 96, targetHeartRate: 110, progress: 0.5,
  currentZone: { id: 'cool', name: 'Cool', color: COOL }, targetZone: { id: 'active', name: 'Active', color: '#22c55e' },
  zoneSequence: SEQUENCE, status: 'missing', holdProgress: null, ...overrides,
});
// The lock modal reads display.riders (the rows regrouped per rider); the
// warning chips read display.rows. Fixtures carry both, as the resolver does.
const display = (rows, status = 'locked') => ({ show: true, status, videoLocked: status === 'locked', activeUserCount: rows.length,
  deadline: Date.now() + 30000, gracePeriodTotal: 30, requirements: [], rows, summary: [], obligations: [],
  riders: groupRidersByGoal([{ key: 'requirement:active', zone: 'active', zoneLabel: 'Active', zoneColor: '#22c55e', rows }]) });

describe('GovernanceStateOverlay — compact feedback', () => {
  it.each(['warning', 'locked'])('%s uses a pedal icon with accessible instruction', (status) => {
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
  it('heart-rate and pedal riders share one row layout: face, name, BPM', () => {
    const { getAllByTestId } = render(<GovernanceStateOverlay display={display([row(), row({ userId: 'rider-b', displayName: 'Rider B', pedal: { rpm: 0, targetRpm: 30 } })])} />);
    const rows = getAllByTestId('lock-rider-row');
    expect(rows).toHaveLength(2);
    rows.forEach((r) => {
      expect(r.querySelector('.governance-lock__face img')).toBeTruthy();
      expect(r.querySelector('.governance-lock__name').textContent).toMatch(/^Rider [AB]$/);
      expect(r.querySelector('.governance-lock__bpm-num').textContent).toBe('96');
    });
  });
});

describe('GovernanceStateOverlay — live current state on the BPM scale', () => {
  it('updates live Cool at 96 and 101 after a prior Active snapshot', () => {
    const view = render(<GovernanceStateOverlay display={display([row({ currentZone: { id: 'active', name: 'Active', color: '#22c55e' }, heartRate: 111 })])} />);
    for (const hr of [96, 101]) {
      view.rerender(<GovernanceStateOverlay display={display([row({ heartRate: hr })])} />);
      const r = view.getByTestId('lock-rider-row');
      expect(r.querySelector('.governance-lock__bpm-num').textContent).toBe(String(hr));
      expect(r.querySelector('.governance-lock__heart').style.color).toMatch(/#94a3b8|rgb\(148, 163, 184\)/);
      expect(r.querySelector('.governance-lock__fill').style.background).toMatch(/#94a3b8|rgb\(148, 163, 184\)/);
      expect(r.querySelector('.governance-lock__gap').textContent).toBe(`+${110 - hr} to Active`);
    }
  });
  // Scale: lowest threshold (60) to the highest goal + 10 (120).
  it.each([[50, '0'], [60, '0'], [96, '0.6'], [114, '0.9'], [120, '1'], [130, '1']])('places %s BPM on the scale at --p %s', (hr, p) => {
    const { container } = render(<GovernanceStateOverlay display={display([row({ heartRate: hr })])} />);
    const track = container.querySelector('.governance-lock__track');
    expect(track.style.getPropertyValue('--p')).toBe(p);
    // The fill reads --p in CSS; it carries no position of its own.
    expect(container.querySelector('.governance-lock__fill').style.transform).toBe('');
  });
  it('labels each goal marker with its zone and BPM, in the zone colour', () => {
    const { container } = render(<GovernanceStateOverlay display={display([row()])} />);
    const marker = container.querySelector('.governance-lock__marker');
    expect(marker.textContent).toBe('Active 110');
    expect(marker.style.getPropertyValue('--marker-color')).toBe('#22c55e');
    expect(marker.style.left).toBe('83.3%');
  });
  it('updates the BPM scale independently from the secondary hold bar', () => {
    const view = render(<GovernanceStateOverlay display={display([row({ heartRate: 96 })])} />);
    view.rerender(<GovernanceStateOverlay display={display([row({ heartRate: 114, holdProgress: { elapsedMs: 4000, remainingMs: 6000, totalMs: 10000 } })])} />);
    expect(view.container.querySelector('.governance-lock__track').style.getPropertyValue('--p')).toBe('0.9');
    expect(view.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('4000');
  });
  it('removes completed blockers immediately when they join the credited faces', () => {
    const view = render(<GovernanceStateOverlay display={display([row()])} />);
    view.rerender(<GovernanceStateOverlay display={{ ...display([]), activeUserCount: 2,
      summary: [{ key: 'requirement:active', zone: 'active', zoneLabel: 'Active', zoneColor: '#22c55e', requiredCount: 2, actualCount: 1, needed: 1, scope: 'any' }],
      obligations: [{ key: 'requirement:active', metRows: [row()] }] }} />);
    expect(view.queryAllByTestId('lock-rider-row')).toHaveLength(0);
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
    const { container, getAllByTestId } = render(<GovernanceStateOverlay display={resolved} />);
    expect(container.querySelector('.governance-lock__instruction').textContent).toBe('Get 1 more rider to Active to keep watching.');
    expect(container.querySelector('.governance-lock__rule').textContent).toBe('Active 3/4');
    expect(container.querySelectorAll('.governance-lock__credit--met')).toHaveLength(3);
    expect(getAllByTestId('lock-rider-row')).toHaveLength(1);
    expect(container.querySelector('.governance-lock__gap').textContent).toBe('+5 to Active');
    expect(container.textContent).not.toContain('Warm');
  });
  it('switches back to the same failed Warm challenge after floor recovery', () => {
    const resolve = (base) => resolveGovernanceDisplay({ isGoverned: true, status: 'locked', activeUserCount: 4, requirements: [base], challenge: { ...challenge, status: 'failed' } }, map, zoneMeta);
    const view = render(<GovernanceStateOverlay display={resolve(floor)} />);
    view.rerender(<GovernanceStateOverlay display={resolve({ ...floor, satisfied: true, missingUsers: [] })} />);
    expect(view.container.querySelector('.governance-lock__instruction').textContent).toBe('Get 1 more rider to Warm to keep watching.');
    expect(view.container.querySelector('.governance-lock__rule').textContent).toBe('Warm 1/2');
    expect(view.container.querySelectorAll('.governance-lock__credit--met')).toHaveLength(1);
    expect(view.getAllByTestId('lock-rider-row')).toHaveLength(2);
  });
});

describe('GovernanceStateOverlay — quiet cooldown chips', () => {
  const quiet = () => ({ ...display([row()], 'unlocked'), videoLocked: false, quiet: true });
  it('renders quiet chips with no meter, scrim or panel while unlocked in cooldown', () => {
    const { container } = render(<GovernanceStateOverlay display={quiet()} />);
    expect(container.querySelector('.governance-progress-overlay--quiet')).toBeTruthy();
    expect(container.querySelectorAll('.governance-progress-overlay__chip')).toHaveLength(1);
    expect(container.textContent).toContain('Rider A');
    expect(container.querySelector('.governance-life-meter')).toBeNull();
    expect(container.querySelector('.governance-warning-scrim')).toBeNull();
    expect(container.querySelector('.governance-lock')).toBeNull();
  });
  it('hands quiet chips to the warning meter without a panel frame', () => {
    const view = render(<GovernanceStateOverlay display={quiet()} />);
    expect(view.container.querySelector('.governance-lock')).toBeNull();
    view.rerender(<GovernanceStateOverlay display={display([row()], 'warning')} />);
    expect(view.container.querySelector('.governance-life-meter')).toBeTruthy();
    expect(view.container.querySelector('.governance-warning-scrim')).toBeTruthy();
    expect(view.container.querySelector('.governance-lock')).toBeNull();
  });
  it('a cycle-lock display (unlocked, quiet false) still renders the panel', () => {
    const { container } = render(<GovernanceStateOverlay display={{ ...display([], 'unlocked'), quiet: false, show: true }} />);
    expect(container.querySelector('.governance-lock')).toBeTruthy();
  });
  it('quiet with zero rows renders nothing at all', () => {
    const { container } = render(<GovernanceStateOverlay display={{ ...display([], 'unlocked'), videoLocked: false, quiet: true }} />);
    expect(container.querySelector('.governance-lock')).toBeNull();
    expect(container.querySelector('.governance-progress-overlay')).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
