import { describe, it, expect } from 'vitest';
import {
  isHomeDashboardConfigRepository,
} from '#apps/home-automation/ports/IHomeDashboardConfigRepository.mjs';

describe('IHomeDashboardConfigRepository contract', () => {
  it('recognises an object implementing load', () => {
    const repo = { load: async () => ({ rooms: [], summary: {} }) };
    expect(isHomeDashboardConfigRepository(repo)).toBe(true);
  });
  it('rejects objects without load', () => {
    expect(isHomeDashboardConfigRepository({})).toBe(false);
    expect(isHomeDashboardConfigRepository(null)).toBe(false);
  });
});
