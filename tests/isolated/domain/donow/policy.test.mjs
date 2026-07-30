import { describe, it, expect } from 'vitest';
import {
  DECISIONS,
  decideDispatch,
  decideOnApprove,
} from '../../../../backend/src/2_domains/donow/policy.mjs';

describe('DoNow Policy — dispatch decision', () => {
  describe('DECISIONS constant', () => {
    it('exports frozen array with three decision types', () => {
      expect(DECISIONS).toEqual(['dispatch', 'pending_approval', 'denied']);
      expect(Object.isFrozen(DECISIONS)).toBe(true);
    });
  });

  describe('decideDispatch table (§3)', () => {
    describe('idle occupancy', () => {
      it('idle state → dispatch', () => {
        const result = decideDispatch({
          occupancy: { state: 'idle', occupantId: null },
          learnerId: 'alice',
          force: undefined,
        });
        expect(result).toBe('dispatch');
      });

      it('idle with force:never_ask → dispatch', () => {
        const result = decideDispatch({
          occupancy: { state: 'idle', occupantId: null },
          learnerId: 'alice',
          force: 'never_ask',
        });
        expect(result).toBe('dispatch');
      });
    });

    describe('active occupancy — same learner', () => {
      it('active + occupantId === learnerId → dispatch', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: 'alice' },
          learnerId: 'alice',
          force: undefined,
        });
        expect(result).toBe('dispatch');
      });

      it('active + occupantId === learnerId + force:never_ask → dispatch', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: 'alice' },
          learnerId: 'alice',
          force: 'never_ask',
        });
        expect(result).toBe('dispatch');
      });
    });

    describe('active occupancy — other occupant', () => {
      it('active + occupantId !== learnerId → pending_approval', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: 'bob' },
          learnerId: 'alice',
          force: undefined,
        });
        expect(result).toBe('pending_approval');
      });

      it('active + occupantId !== learnerId + force:never_ask → denied', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: 'bob' },
          learnerId: 'alice',
          force: 'never_ask',
        });
        expect(result).toBe('denied');
      });
    });

    describe('active occupancy — null occupantId', () => {
      it('active + occupantId: null → pending_approval', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: null },
          learnerId: 'alice',
          force: undefined,
        });
        expect(result).toBe('pending_approval');
      });

      it('active + occupantId: null + force:never_ask → denied', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: null },
          learnerId: 'alice',
          force: 'never_ask',
        });
        expect(result).toBe('denied');
      });
    });

    describe('unknown occupancy', () => {
      it('unknown state → pending_approval', () => {
        const result = decideDispatch({
          occupancy: { state: 'unknown', occupantId: null },
          learnerId: 'alice',
          force: undefined,
        });
        expect(result).toBe('pending_approval');
      });

      it('unknown state + force:never_ask → denied', () => {
        const result = decideDispatch({
          occupancy: { state: 'unknown', occupantId: null },
          learnerId: 'alice',
          force: 'never_ask',
        });
        expect(result).toBe('denied');
      });
    });
  });

  describe('decideOnApprove table (§4)', () => {
    describe('idle occupancy at approve time', () => {
      it('idle → dispatch', () => {
        const result = decideOnApprove({
          occupancy: { state: 'idle', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('dispatch');
      });
    });

    describe('occupant equals learnerId', () => {
      it('occupant === learnerId → dispatch', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: 'alice' },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('dispatch');
      });
    });

    describe('occupant equals pendingOccupant', () => {
      it('occupant === pendingOccupant (same occupant) → dispatch', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: 'bob' },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('dispatch');
      });
    });

    describe('different occupant', () => {
      it('different occupant first time → repend', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: 'charlie' },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('repend');
      });

      it('different occupant when already repended → denied', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: 'charlie' },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: true,
        });
        expect(result).toBe('denied');
      });
    });

    describe('unknown occupancy at approve time', () => {
      it('unknown first time → repend', () => {
        const result = decideOnApprove({
          occupancy: { state: 'unknown', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('repend');
      });

      it('unknown when already repended → denied', () => {
        const result = decideOnApprove({
          occupancy: { state: 'unknown', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: true,
        });
        expect(result).toBe('denied');
      });
    });

    describe('null pendingOccupant edge cases', () => {
      it('occupant null when pendingOccupant null → dispatch (same occupant)', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: null,
          repended: false,
        });
        expect(result).toBe('dispatch');
      });

      it('occupant null when pendingOccupant is string → different, first time → repend', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('repend');
      });

      it('occupant string when pendingOccupant null → different, first time → repend', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: 'bob' },
          learnerId: 'alice',
          pendingOccupant: null,
          repended: false,
        });
        expect(result).toBe('repend');
      });
    });
  });
});
