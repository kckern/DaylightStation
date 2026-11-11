import { describe, it, expect } from 'vitest';
import { mutedExcuseFor } from './obligationCopy.js';

describe('day-off excuse copy', () => {
  it('names a tier day off and a placeholder holiday activity', () => {
    expect(mutedExcuseFor('day_off')).toBe('A day off — only the kept work is asked.');
    expect(mutedExcuseFor('placeholder')).toBe('This holiday activity is still being written.');
  });
});
