import { vi, describe, test, expect } from 'vitest';

describe('autoplay blocked detection', () => {
  test('NotAllowedError from play() signals autoplay blocked', () => {
    let blocked = false;
    const target = {
      play: vi.fn(() => Promise.reject({ name: 'NotAllowedError' }))
    };

    const p = target.play();
    p.catch((err) => {
      if (err?.name === 'NotAllowedError') blocked = true;
    });

    return p.catch(() => {}).then(() => {
      expect(blocked).toBe(true);
    });
  });

  test('AbortError from play() does NOT signal autoplay blocked', () => {
    let blocked = false;
    const target = {
      play: vi.fn(() => Promise.reject({ name: 'AbortError' }))
    };

    const p = target.play();
    p.catch((err) => {
      if (err?.name === 'NotAllowedError') blocked = true;
    });

    return p.catch(() => {}).then(() => {
      expect(blocked).toBe(false);
    });
  });

  test('successful play() clears autoplay blocked', () => {
    let blocked = true;
    const target = {
      play: vi.fn(() => Promise.resolve())
    };

    const p = target.play();
    p.then(() => { blocked = false; });

    return p.then(() => {
      expect(blocked).toBe(false);
    });
  });

  test('user gesture retry calls play() and resolves', async () => {
    const target = {
      play: vi.fn(() => Promise.resolve())
    };
    let resolved = false;
    const onResolved = () => { resolved = true; };

    const p = target.play();
    await p.then(() => onResolved());

    expect(target.play).toHaveBeenCalled();
    expect(resolved).toBe(true);
  });
});
