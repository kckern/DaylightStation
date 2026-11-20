import { describe, it, expect } from 'vitest';
import { chooseForwardAction } from './forwardAction.mjs';

const sections = [
  { subject: 'math', servedToday: false, next: { unitId: 'm-2', title: 'Mastery' } },
  { subject: 'civilization', servedToday: false, next: { unitId: 'c-1', title: 'Oregon' } },
];

describe('chooseForwardAction after a makeup pass', () => {
  it('offers the same subject\'s lesson for today first', () => {
    expect(chooseForwardAction({ sections, subject: 'math', passedWasMakeup: true }))
      .toMatchObject({ tier: 1, subject: 'math', description: 'Still to do today: math.' });
  });
  it('an ordinary pass still skips its own subject', () => {
    expect(chooseForwardAction({ sections, subject: 'math' })).toMatchObject({ subject: 'civilization' });
  });
});
