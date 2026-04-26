import { describe, it, expect } from 'vitest';
import { BarcodeGatekeeper } from '#domains/barcode/BarcodeGatekeeper.mjs';
import { autoApprove } from '#domains/barcode/strategies/AutoApproveStrategy.mjs';

const SCAN_CONTEXT = {
  contentId: 'plex:12345',
  targetScreen: 'office',
  action: 'queue',
  device: 'scanner-1',
  timestamp: '2026-03-30T01:00:00Z',
  policyGroup: 'default',
};

describe('BarcodeGatekeeper', () => {
  describe('with no strategies', () => {
    it('approves by default', async () => {
      const gatekeeper = new BarcodeGatekeeper([]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(true);
    });
  });

  describe('with AutoApproveStrategy', () => {
    it('approves', async () => {
      const gatekeeper = new BarcodeGatekeeper([autoApprove]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(true);
    });
  });

  describe('with a denying strategy', () => {
    it('denies with reason', async () => {
      const denyAll = async () => ({ approved: false, reason: 'blocked by test' });
      const gatekeeper = new BarcodeGatekeeper([denyAll]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('blocked by test');
    });
  });

  describe('strategy ordering', () => {
    it('stops at first denial', async () => {
      const calls = [];
      const approve = async () => { calls.push('approve'); return { approved: true }; };
      const deny = async () => { calls.push('deny'); return { approved: false, reason: 'denied' }; };
      const neverCalled = async () => { calls.push('never'); return { approved: true }; };

      const gatekeeper = new BarcodeGatekeeper([approve, deny, neverCalled]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);

      expect(result.approved).toBe(false);
      expect(calls).toEqual(['approve', 'deny']);
    });

    it('approves when all strategies approve', async () => {
      const approve1 = async () => ({ approved: true });
      const approve2 = async () => ({ approved: true });

      const gatekeeper = new BarcodeGatekeeper([approve1, approve2]);
      const result = await gatekeeper.evaluate(SCAN_CONTEXT);
      expect(result.approved).toBe(true);
    });
  });
});
