import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import CircularUserAvatar from "./CircularUserAvatar.jsx";

describe('CircularUserAvatar boostBadge', () => {
  it('renders a boost badge when boostBadge is provided', () => {
    const { container } = render(<CircularUserAvatar name="User_2" boostBadge="×1.5" />);
    const badge = container.querySelector('.vital-boost-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('×1.5');
  });

  it('renders no badge when boostBadge is absent', () => {
    const { container } = render(<CircularUserAvatar name="User_2" />);
    expect(container.querySelector('.vital-boost-badge')).toBeNull();
  });
});

describe('CircularUserAvatar no-HR state', () => {
  it('hides the zone gauge and adds .no-hr when there is no active HR', () => {
    const { container } = render(
      <CircularUserAvatar name="KC" zoneColor="#22d3ee" heartRate={0} showGauge={true} />
    );
    expect(container.querySelector('.zone-progress-gauge')).toBeNull();
    expect(container.querySelector('.circular-user-avatar.no-hr')).not.toBeNull();
  });

  it('shows the zone gauge when there is active HR', () => {
    const { container } = render(
      <CircularUserAvatar name="KC" zoneColor="#e67e22" heartRate={150} zoneId="hot" showGauge={true} />
    );
    expect(container.querySelector('.zone-progress-gauge')).not.toBeNull();
    expect(container.querySelector('.circular-user-avatar.no-hr')).toBeNull();
  });
});

describe('CircularUserAvatar weakSignal', () => {
  it('adds .weak-signal when weakSignal is true', () => {
    const { container } = render(<CircularUserAvatar name="#10266" weakSignal heartRate={59} />);
    expect(container.querySelector('.circular-user-avatar.weak-signal')).not.toBeNull();
  });

  it('omits .weak-signal by default', () => {
    const { container } = render(<CircularUserAvatar name="User_2" heartRate={120} />);
    expect(container.querySelector('.circular-user-avatar.weak-signal')).toBeNull();
  });
});

describe('CircularUserAvatar statusBadge', () => {
  it('renders "Reach Hot" for a child who has not started', () => {
    const { container } = render(
      <CircularUserAvatar name="Child B" statusBadge={{ status: 'reach-start', zoneLabel: 'hot' }} />
    );
    const badge = container.querySelector('.governance-start-badge');
    expect(badge.textContent).toBe('Reach Hot');
    expect(badge.classList.contains('governance-start-badge--overdue')).toBe(false);
  });

  it('renders the overdue badge in the warning style', () => {
    const { container } = render(
      <CircularUserAvatar name="Child B" statusBadge={{ status: 'start-overdue', zoneLabel: 'Hot' }} />
    );
    const badge = container.querySelector('.governance-start-badge');
    expect(badge.textContent).toBe('Reach Hot');
    expect(badge.classList.contains('governance-start-badge--overdue')).toBe(true);
  });

  it('renders no start badge for a holding or absent status', () => {
    const { container } = render(<CircularUserAvatar name="Child B" statusBadge={{ status: 'holding', zoneLabel: 'Hot' }} />);
    expect(container.querySelector('.governance-start-badge')).toBeNull();
  });
});

describe('CircularUserAvatar zone ring laps on a zone crossing', () => {
  const angleOf = (container) => parseFloat(container.querySelector('.zone-progress-orbit').style.getPropertyValue('--indicator-angle'));
  const ring = (props) => <CircularUserAvatar name="Rider A" heartRate={150} size={120} {...props} />;
  const angles = [];
  const lapPart = () => angles.slice(0, angles.indexOf(angles.at(-1)));
  const run = async (ms) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

  beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }); angles.length = 0; });
  afterEach(() => vi.useRealTimers());

  it('up a zone: the dot carries on clockwise past 3 o\'clock instead of sweeping back', async () => {
    const { container, rerender } = render(ring({ zoneId: 'warm', zoneColor: 'yellow', progress: 0.97 }));
    expect(angleOf(container)).toBeCloseTo(354.6, 1);
    rerender(ring({ zoneId: 'hot', zoneColor: 'orange', progress: 0.1 }));
    for (let i = 0; i < 30; i += 1) { await run(16); angles.push(angleOf(container)); }
    // Monotonic forward: never below where it started, through 450 (6 o'clock)…
    expect(Math.min(...lapPart())).toBeGreaterThanOrEqual(354.6);
    expect(angles.some((a) => a > 440 && a < 470)).toBe(true);
    // …then folded back into the meter once it lands: Hot at 10%.
    expect(angles.at(-1)).toBeCloseTo(198, 5);
    expect(container.querySelector('.gauge-arc-previous').style.visibility).toBe('hidden');
  });

  it('mid-lap the bottom is two colours: the new one behind the dot, the old one ahead', async () => {
    const { container, rerender } = render(ring({ zoneId: 'warm', zoneColor: 'yellow', progress: 0.97 }));
    rerender(ring({ zoneId: 'hot', zoneColor: 'orange', progress: 0.1 }));
    await run(48);
    const previous = container.querySelector('.gauge-arc-previous');
    expect(angleOf(container)).toBeGreaterThan(360);
    expect(angleOf(container)).toBeLessThan(540);
    expect(previous.style.visibility).toBe('visible');
    expect(previous.style.stroke).toBe('yellow');
  });

  it('down a zone: the dot runs counter-clockwise, through 6 and 3 o\'clock', async () => {
    const { container, rerender } = render(ring({ zoneId: 'hot', zoneColor: 'orange', progress: 0.05 }));
    rerender(ring({ zoneId: 'warm', zoneColor: 'yellow', progress: 0.9 }));
    for (let i = 0; i < 30; i += 1) { await run(16); angles.push(angleOf(container)); }
    expect(Math.max(...lapPart())).toBeLessThanOrEqual(189);
    expect(angles.some((a) => a > 75 && a < 105)).toBe(true);
    expect(angles.at(-1)).toBeCloseTo(342, 5);
  });

  it('a progress change inside a zone just glides, no lap', async () => {
    const { container, rerender } = render(ring({ zoneId: 'warm', zoneColor: 'yellow', progress: 0.2 }));
    rerender(ring({ zoneId: 'warm', zoneColor: 'yellow', progress: 0.6 }));
    for (let i = 0; i < 25; i += 1) { await run(16); angles.push(angleOf(container)); }
    expect(Math.min(...angles)).toBeGreaterThanOrEqual(216);
    expect(Math.max(...angles)).toBeLessThanOrEqual(288);
    expect(angles.at(-1)).toBeCloseTo(288, 5);
  });

  it('into Fire: no dot, a full ring', async () => {
    const { container, rerender } = render(ring({ zoneId: 'hot', zoneColor: 'orange', progress: 0.95 }));
    rerender(ring({ zoneId: 'fire', zoneColor: 'red', progress: 1, showIndicator: false }));
    await run(400);
    expect(container.querySelector('.zone-progress-orbit')).toBeNull();
    const current = container.querySelectorAll('.gauge-arc-progress')[1];
    expect(parseFloat(current.style.strokeDasharray)).toBeCloseTo(2 * Math.PI * 47, 1);
  });
});
