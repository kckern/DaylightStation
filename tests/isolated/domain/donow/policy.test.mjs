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

    describe('CRITICAL: null learner edge cases', () => {
      it('active + null occupantId + null learnerId → pending_approval (not dispatch)', () => {
        const result = decideDispatch({
          occupancy: { state: 'active', occupantId: null },
          learnerId: null,
          force: undefined,
        });
        expect(result).toBe('pending_approval');
      });
    });

    describe('malformed occupancy (fail closed)', () => {
      it('missing state property → pending_approval', () => {
        const result = decideDispatch({
          occupancy: { occupantId: 'bob' },
          learnerId: 'alice',
          force: undefined,
        });
        expect(result).toBe('pending_approval');
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

      it('idle + repended:true → dispatch (repend flag does not deny idle)', () => {
        const result = decideOnApprove({
          occupancy: { state: 'idle', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: true,
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

    // Anonymous-occupant surfaces (2026-08-23 field bug). The piano kiosk's
    // MidiPresenceTracker reports state:'active' with occupantId ALWAYS null —
    // it knows the piano is in use, never by whom. Before this case, such an
    // approval could never resolve: it re-pended once, then denied, so the
    // "we asked a grown-up" path was a dead end and the surface unreachable
    // whenever anyone had touched the piano within the 5-minute TTL.
    describe('anonymous occupant (surface cannot identify who is there)', () => {
      it('both pending and current occupant null → dispatch (the parent approved THIS situation)', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: null },
          learnerId: null,
          pendingOccupant: null,
          repended: false,
        });
        expect(result).toBe('dispatch');
      });

      it('anonymous + a learnerId still dispatches — no name was ever on offer', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: null,
          repended: false,
        });
        expect(result).toBe('dispatch');
      });

      it('does NOT loosen identified surfaces: named pending → anonymous now still re-pends', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: null },
          learnerId: 'alice',
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('repend');
      });

      it('does NOT loosen identified surfaces: anonymous pending → named now still re-pends', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: 'charlie' },
          learnerId: 'alice',
          pendingOccupant: null,
          repended: false,
        });
        expect(result).toBe('repend');
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
      // REVERSED 2026-08-23 (was: 'repend — unknown changes require re-ask').
      // Field evidence: the piano kiosk's presence tracker reports occupantId
      // null ALWAYS, so this branch re-pended once and then DENIED every
      // approval — the surface was unreachable whenever anyone had played in
      // the last 5 minutes, and the parent's "yes" did nothing. The original
      // rationale also does not survive scrutiny: when pendingOccupant was
      // already null the parent was never shown a name, and a re-ask presents
      // that IDENTICAL nameless state — there is no new fact to re-ask about.
      // Re-pending only earns its keep when the NAME changed, which the
      // neighbouring cases still cover.
      it('occupant null when pendingOccupant null → dispatch (a re-ask would show the parent nothing new)', () => {
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

    describe('CRITICAL: null learnerId edge cases', () => {
      it('occupant null, learnerId null, pendingOccupant string → different, first time → repend', () => {
        const result = decideOnApprove({
          occupancy: { state: 'active', occupantId: null },
          learnerId: null,
          pendingOccupant: 'bob',
          repended: false,
        });
        expect(result).toBe('repend');
      });
    });
  });
});
