import { describe, it, expect } from 'vitest';
import { buildFireToast, FIRE_TOAST_DURATION_MS } from './buildFireToast.js';

describe('buildFireToast', () => {
  it('marks the toast as the frameless fire kind', () => {
    const toast = buildFireToast({ userId: 'learner-one', name: 'Learner-One' });
    expect(toast.kind).toBe('fire');
    expect(toast.frameless).toBe(true);
  });

  it('resolves the avatar from the user id', () => {
    const toast = buildFireToast({ userId: 'learner-one', name: 'Learner-One' });
    expect(toast.avatarUrl).toBe('/api/v1/static/img/users/learner-one');
  });

  it('carries the display name', () => {
    const toast = buildFireToast({ userId: 'learner-one', name: 'Learner-Two' });
    expect(toast.name).toBe('Learner-Two');
  });

  it('falls back to the user id when no name resolved', () => {
    const toast = buildFireToast({ userId: 'learner-one' });
    expect(toast.name).toBe('learner-one');
  });

  it('passes the fireball url through from the caller', () => {
    const toast = buildFireToast(
      { userId: 'learner-one', name: 'Learner-One' },
      { fireballUrl: 'http://host/api/v1/proxy/media/fitness/ux/fireball.gif' }
    );
    expect(toast.fireballUrl).toBe('http://host/api/v1/proxy/media/fitness/ux/fireball.gif');
  });

  it('leaves the fireball url null when the caller has none', () => {
    const toast = buildFireToast({ userId: 'learner-one', name: 'Learner-One' });
    expect(toast.fireballUrl).toBeNull();
  });

  it('lives as long as a ring celebration', () => {
    expect(buildFireToast({ userId: 'learner-one' }).durationMs).toBe(FIRE_TOAST_DURATION_MS);
    expect(FIRE_TOAST_DURATION_MS).toBe(3500);
  });
});
