import { it, expect, vi } from 'vitest';
import { AcknowledgeSelfServiceMount } from './AcknowledgeSelfServiceMount.mjs';
import { HmacSchoolMountReceiptIssuer } from '../../adapters/actions/HmacSchoolMountReceiptIssuer.mjs';
it('wrong device, wrong purpose or expired receipt cannot commit', async () => {
  let now = 1000000;
  const issuer = new HmacSchoolMountReceiptIssuer({ key: 'k'.repeat(32), householdId: 'home', clock: () => now });
  const recordUse = vi.fn(); const settleMountUse = vi.fn();
  const ack = new AcknowledgeSelfServiceMount({ tokens: { recordUse, settleMountUse }, mountReceiptIssuer: issuer, clock: () => new Date(now) });
  const receipt = issuer.issue({ token: 'sch:TESTTOKEN', useId: 'use', learnerId: 'kid1', deviceId: 'kiosk', action: 'program', expiresAt: new Date(now+120000).toISOString() });
  for (const input of [{ receipt, deviceId: 'other' }, { receipt: issuer.issueSession(), deviceId: 'kiosk' }]) {
    const invalidAck = await ack.execute({ ...input, mounted: true });
    expect(invalidAck.ok).toBe(false);
  }
  now += 120000;
  expect((await ack.execute({ receipt, deviceId: 'kiosk', mounted: true })).ok).toBe(false);
  expect(recordUse).not.toHaveBeenCalled(); expect(settleMountUse).not.toHaveBeenCalled();
});
