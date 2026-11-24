import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
vi.mock('./GovernanceAudioPlayer.jsx', () => ({ default: () => null }));
import GovernanceStateOverlay from './GovernanceStateOverlay.jsx';
import { resolveGovernanceDisplay } from '../../hooks/useGovernanceDisplay.js';

// Lock modal: one row per rider across every rule, real BPM targets, a plain
// instruction. Built through the real resolver so the fixtures match production.
const ZONES = { map: Object.fromEntries(['cool', 'active', 'warm', 'hot'].map((id, rank) =>
  [id, { id, name: id[0].toUpperCase() + id.slice(1), rank, color: ['#94a3b8', '#22c55e', '#eab308', '#f97316'][rank] }])) };
const SEQUENCE = [{ id: 'cool', threshold: 60 }, { id: 'active', threshold: 100 }, { id: 'warm', threshold: 120 }, { id: 'hot', threshold: 140 }];
const profile = (name, heartRate, zoneId = 'cool') => ({ displayName: name, avatarSrc: '', heartRate, zoneId,
  zoneTrusted: heartRate != null, zoneSequence: heartRate != null ? SEQUENCE : [] });
const rule = (zone, requiredCount, missingUsers, metUsers = []) => ({ id: `${zone}-floor`, type: 'zone', zone,
  zoneLabel: ZONES.map[zone].name, requiredCount, actualCount: metUsers.length, satisfied: false, missingUsers, metUsers, eligibleMetUsers: metUsers });
const resolve = (requirements, riders) => resolveGovernanceDisplay({ isGoverned: true, status: 'locked', videoLocked: true,
  activeUserCount: Object.keys(riders).length, requirements }, new Map(Object.entries(riders)), ZONES);

const twoByTwo = () => resolve([rule('hot', 1, ['rider-a', 'rider-b']), rule('active', 2, ['rider-a', 'rider-b'])],
  { 'rider-a': profile('Rider A Longername', 85), 'rider-b': profile('Rider B', 105, 'active') });

describe('GovernanceStateOverlay — lock modal rows per rider', () => {
  it('two riders under two rules render exactly two rows with names, BPM, both markers and the gap', () => {
    const { getAllByTestId } = render(<GovernanceStateOverlay display={twoByTwo()} />);
    const rows = getAllByTestId('lock-rider-row');
    expect(rows).toHaveLength(2);
    const text = rows.map((r) => r.textContent);
    expect(text.some((t) => t.includes('Rider A Longername'))).toBe(true);
    expect(text.some((t) => t.includes('Rider B'))).toBe(true);
    expect(text.some((t) => t.includes('85'))).toBe(true);
    expect(text.some((t) => t.includes('105'))).toBe(true);
    rows.forEach((r) => {
      const markers = [...r.querySelectorAll('.governance-lock__marker')].map((m) => m.textContent);
      expect(markers).toEqual(['Active 100', 'Hot 140']);
      expect(r.textContent).toMatch(/\+\d+ to /);
    });
    const a = rows.find((r) => r.textContent.includes('Rider A'));
    expect(a.textContent).toContain('+15 to Active');
    const b = rows.find((r) => r.textContent.includes('Rider B'));
    expect(b.textContent).toContain('+35 to Hot');
  });

  it('says the video is paused and what unlocks it in one sentence', () => {
    render(<GovernanceStateOverlay display={twoByTwo()} />);
    expect(screen.getByText('Video paused')).toBeTruthy();
    expect(screen.getByText(/Get 1 rider to Hot and both riders to Active to keep watching/)).toBeTruthy();
  });

  it('shows a zone-coloured chip per rule with its count and no open slots', () => {
    const { container } = render(<GovernanceStateOverlay display={twoByTwo()} />);
    const chips = [...container.querySelectorAll('.governance-lock__rule')].map((c) => c.textContent);
    expect(chips).toEqual(['Hot 0/1', 'Active 0/2']);
    expect(container.querySelector('[class*="--open"]')).toBeNull();
  });

  it('has no percentage badge and no zone pills', () => {
    const { container } = render(<GovernanceStateOverlay display={twoByTwo()} />);
    expect(container.textContent).not.toMatch(/\d+%/);
    expect(container.querySelector('.governance-lock__pill')).toBeNull();
  });

  it('renders exactly one lock button', () => {
    render(<GovernanceStateOverlay display={twoByTwo()} onUnlock={() => {}} />);
    expect(screen.getAllByRole('button', { name: /skip or unlock/i })).toHaveLength(1);
  });

  it('names riders with no heart-rate signal in a footer', () => {
    const display = resolve([rule('hot', 1, ['rider-a', 'rider-b'])], { 'rider-a': profile('Rider A', 85), 'rider-b': profile('Rider B', null, null) });
    const { getAllByTestId } = render(<GovernanceStateOverlay display={display} />);
    expect(getAllByTestId('lock-rider-row')).toHaveLength(1);
    expect(screen.getByText('No heart-rate signal: Rider B')).toBeTruthy();
  });

  it('a met rider shows as a filled face inside the rule chip', () => {
    const display = resolve([rule('active', 2, ['rider-b'], ['rider-a'])], { 'rider-a': profile('Rider A', 110, 'active'), 'rider-b': profile('Rider B', 90) });
    const { container } = render(<GovernanceStateOverlay display={display} />);
    const chip = container.querySelector('.governance-lock__rule');
    expect(chip.textContent).toBe('Active 1/2');
    expect(chip.querySelectorAll('.governance-lock__credit--met')).toHaveLength(1);
    expect(screen.getByText(/Get both riders to Active to keep watching/)).toBeTruthy();
  });
});
