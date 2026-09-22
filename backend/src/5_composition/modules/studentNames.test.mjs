import { describe, it, expect } from 'vitest';
import { studentDisplayName } from './studentNames.mjs';

describe('studentDisplayName', () => {
  const configService = {
    getUserProfile: (id) => (id === 'user_4' ? { display_name: 'Learner4', name: 'Someone' } : null),
  };
  const resolve = studentDisplayName(configService);

  it('reads the profile display_name', () => {
    expect(resolve('user_4')).toBe('Learner4');
  });
  it('falls back to a title-cased id when there is no profile', () => {
    expect(resolve('user_5')).toBe('User 5');
  });
  it('tolerates a config service with no profile reader', () => {
    expect(studentDisplayName({})('user_6')).toBe('User 6');
  });
});
