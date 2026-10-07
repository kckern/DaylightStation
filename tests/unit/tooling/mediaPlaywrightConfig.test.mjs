import { describe, expect, it } from 'vitest';
import config from '../../../playwright.config.mjs';

describe('Playwright config: Media journeys', () => {
  it('runs tests/live/flow/media/** in a single-worker project (the household reset in beforeEach wipes shared server state)', () => {
    const media = config.projects.find(({ name }) => name === 'media');
    expect(media).toBeTruthy();
    expect(media.workers).toBe(1);
    expect(media.fullyParallel).toBe(false);
    expect(media.testMatch).toMatch(/live\/flow\/media/);
  });

  it('keeps every other flow out of the media project and Media out of the default one', () => {
    const other = config.projects.find(({ name }) => name === 'default');
    expect(other.testIgnore).toMatch(/live\/flow\/media/);
  });
});
