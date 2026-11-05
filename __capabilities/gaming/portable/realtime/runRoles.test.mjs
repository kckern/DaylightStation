import { describe, it, expect } from 'vitest';
import { projectRunRole, RUN_ROLES } from './runRoles.mjs';

describe('projectRunRole', () => {
  it('lowercases a known phase', () => expect(projectRunRole('PLAYING')).toBe('playing'));
  it('applies a mapping', () => expect(projectRunRole('GAME_OVER', { GAME_OVER: 'result' })).toBe('result'));
  it('falls back to ready', () => expect(projectRunRole('nonsense')).toBe('ready'));
  it('exposes the role list', () => expect(RUN_ROLES).toHaveLength(6));
});
