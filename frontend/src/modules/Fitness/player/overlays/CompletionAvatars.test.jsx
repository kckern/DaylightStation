import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CompletionAvatars from './CompletionAvatars.jsx';

const rider = (key, overrides = {}) => ({
  key,
  userId: key,
  displayName: key.toUpperCase(),
  avatarSrc: `/img/${key}`,
  currentZone: { id: 'cardio', color: '#f97316' },
  ...overrides
});

const creditsOf = (container) =>
  Array.from(container.querySelectorAll('.governance-lock__credit'));

describe('CompletionAvatars', () => {
  it('renders one slot per required participant', () => {
    const { container } = render(
      <CompletionAvatars targetCount={3} actualCount={1} metRows={[rider('a')]} />
    );
    expect(creditsOf(container)).toHaveLength(3);
  });

  it('shows the face of each participant who has earned their slot', () => {
    const { container } = render(
      <CompletionAvatars targetCount={3} actualCount={2} metRows={[rider('a'), rider('b')]} />
    );
    const met = container.querySelectorAll('.governance-lock__credit--met img');
    expect(Array.from(met).map((img) => img.getAttribute('src'))).toEqual(['/img/a', '/img/b']);
  });

  it('leaves the remaining slots open', () => {
    const { container } = render(
      <CompletionAvatars targetCount={3} actualCount={1} metRows={[rider('a')]} />
    );
    expect(container.querySelectorAll('.governance-lock__credit--open')).toHaveLength(2);
  });

  it('rings each earned slot in that participant zone color', () => {
    const { container } = render(
      <CompletionAvatars
        targetCount={2}
        actualCount={1}
        metRows={[rider('a', { currentZone: { id: 'peak', color: '#ef4444' } })]}
      />
    );
    const met = container.querySelector('.governance-lock__credit--met');
    expect(met.style.getPropertyValue('--credit-ring')).toBe('#ef4444');
  });

  it('keeps a slot filled when governance counts it but the rider is unresolved', () => {
    // actualCount is the authority; metRows can lag by one when the display map
    // has no entry. The slot must not read as still-open.
    const { container } = render(
      <CompletionAvatars targetCount={2} actualCount={2} metRows={[rider('a')]} />
    );
    expect(container.querySelectorAll('.governance-lock__credit--open')).toHaveLength(0);
    expect(creditsOf(container)).toHaveLength(2);
  });

  it('never fills more slots than the target requires', () => {
    const { container } = render(
      <CompletionAvatars targetCount={2} actualCount={5} metRows={[rider('a'), rider('b'), rider('c')]} />
    );
    expect(creditsOf(container)).toHaveLength(2);
  });

  it('names the earned participants for screen readers', () => {
    const { container } = render(
      <CompletionAvatars targetCount={2} actualCount={1} metRows={[rider('a')]} />
    );
    const meter = container.querySelector('[role="meter"]');
    expect(meter.getAttribute('aria-label')).toContain('A');
    expect(meter.getAttribute('aria-valuenow')).toBe('1');
    expect(meter.getAttribute('aria-valuemax')).toBe('2');
  });

  it('renders nothing when there is no target to meet', () => {
    const { container } = render(
      <CompletionAvatars targetCount={0} actualCount={0} metRows={[]} />
    );
    expect(container.firstChild).toBeNull();
  });
});
