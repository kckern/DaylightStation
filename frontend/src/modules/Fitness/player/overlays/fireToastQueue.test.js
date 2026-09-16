import { describe, it, expect } from 'vitest';
import { planFireToasts } from './fireToastQueue.js';

const learnerOne = { userId: 'learner-one', name: 'Learner-One' };
const learnerTwo = { userId: 'learner-two', name: 'Learner-Two' };

describe('planFireToasts', () => {
  it('waits its turn while another toast is on screen', () => {
    // A challenge celebration or ring card must not be stomped mid-display.
    const r = planFireToasts({ currentToast: { id: 4, kind: 'ring-celebration' }, queue: [learnerOne] });
    expect(r.show).toBeNull();
    expect(r.queue).toEqual([learnerOne]);
  });

  it('shows the first queued person once the slot is clear', () => {
    const r = planFireToasts({ currentToast: null, queue: [learnerOne] });
    expect(r.show).toEqual(learnerOne);
    expect(r.queue).toEqual([]);
  });

  it('keeps the rest queued so each person gets their own moment', () => {
    const r = planFireToasts({ currentToast: null, queue: [learnerOne, learnerTwo] });
    expect(r.show).toEqual(learnerOne);
    expect(r.queue).toEqual([learnerTwo]);
  });

  it('does nothing when nobody is waiting', () => {
    const r = planFireToasts({ currentToast: null, queue: [] });
    expect(r.show).toBeNull();
    expect(r.queue).toEqual([]);
  });

  it('tolerates a missing queue', () => {
    const r = planFireToasts({ currentToast: null });
    expect(r.show).toBeNull();
    expect(r.queue).toEqual([]);
  });

  it('never mutates the queue it was handed', () => {
    const queue = [learnerOne, learnerTwo];
    planFireToasts({ currentToast: null, queue });
    expect(queue).toEqual([learnerOne, learnerTwo]);
  });
});
