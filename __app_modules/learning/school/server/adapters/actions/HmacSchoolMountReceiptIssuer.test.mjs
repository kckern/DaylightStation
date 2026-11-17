import { it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { HmacSchoolMountReceiptIssuer, MOUNT_RECEIPT_PURPOSE } from './HmacSchoolMountReceiptIssuer.mjs';
const key = 'k'.repeat(32); const now = 1000000;
const args = { token: 'sch:TESTTOKEN', useId: 'use1', learnerId: 'kid1', deviceId: 'kiosk1', action: 'program', expiresAt: new Date(now+120000).toISOString() };
const issuer = (householdId = 'home', clock = () => now) => new HmacSchoolMountReceiptIssuer({ key, householdId, clock });
it('binds signed receipt to purpose, household, identity and expiry', () => {
  const receipt = issuer().issue(args);
  expect(issuer().verify(receipt, { deviceId: 'kiosk1' }).payload).toMatchObject({ token: args.token, useId: args.useId, learnerId: args.learnerId, action: args.action, householdId: 'home', purpose: MOUNT_RECEIPT_PURPOSE, exp: now+120000 });
});
it('rejects wrong device, wrong household, wrong purpose, tampering and expiry', () => {
  const receipt = issuer().issue(args);
  expect(issuer().verify(receipt, { deviceId: 'other' }).ok).toBe(false);
  expect(issuer('other').verify(receipt, { deviceId: 'kiosk1' }).ok).toBe(false);
  expect(issuer('home', () => now+120000).verify(receipt, { deviceId: 'kiosk1' }).ok).toBe(false);
  expect(issuer().verify(receipt+'x', { deviceId: 'kiosk1' }).ok).toBe(false);
  const body = Buffer.from(JSON.stringify({ ...args, householdId: 'home', purpose: 'school-gratitude', exp: now+120000 })).toString('base64url');
  const derived = createHmac('sha256', key).update(MOUNT_RECEIPT_PURPOSE).digest();
  const wrongPurpose = `${body}.${createHmac('sha256', derived).update(body).digest('base64url')}`;
  expect(issuer().verify(wrongPurpose, { deviceId: 'kiosk1' }).ok).toBe(false);
});
it('session identity is server-issued and cannot be used as a receipt', () => {
  const signer = issuer(); const cookie = signer.issueSession();
  expect(signer.sessionIdentity(cookie)).toMatch(/^session:/);
  expect(signer.sessionIdentity('caller-label')).toBe(null);
  expect(signer.verify(cookie, { deviceId: signer.sessionIdentity(cookie) }).ok).toBe(false);
  expect(issuer('other').sessionIdentity(cookie)).toBe(null);
});
it('missing household signing material fails closed', () => {
  expect(() => new HmacSchoolMountReceiptIssuer({ householdId: 'home' })).toThrow();
});
