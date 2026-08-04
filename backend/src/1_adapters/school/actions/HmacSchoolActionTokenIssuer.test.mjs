import { describe, expect, it } from 'vitest';
import { ISchoolActionTokenIssuer } from '#apps/school/ports/ISchoolActionTokenIssuer.mjs';
import { HmacSchoolActionTokenIssuer } from './HmacSchoolActionTokenIssuer.mjs';

const binding = Object.freeze({
  deviceId: 'SC86A001',
  address: 'main/physics/mechanics/motion/velocity',
  actionId: 'worksheet:velocity',
  tokenVersion: 1,
});

function registry() {
  const values = new Map();
  return {
    values,
    async claim(record) {
      const prior = values.get(record.token);
      if (!prior) { values.set(record.token, structuredClone(record)); return { status: 'accepted', record }; }
      const same = JSON.stringify(prior.subject) === JSON.stringify(record.subject)
        && prior.tokenClass === record.tokenClass;
      return { status: same ? 'duplicate' : 'conflict', record: prior };
    },
  };
}

describe('HMAC School action token issuer', () => {
  it('implements the application port and deterministically claims an opaque 80-bit body', async () => {
    const tokens = registry();
    const issuer = new HmacSchoolActionTokenIssuer({
      key: 'a dedicated school action key with 32+ bytes', tokens,
      clock: () => new Date('2026-08-02T12:00:00.000Z'),
    });
    expect(issuer).toBeInstanceOf(ISchoolActionTokenIssuer);
    const first = await issuer.issue(binding);
    const second = await issuer.issue(binding);
    expect(first.token).toMatch(/^sch:[2-9A-HJ-NP-Z]{16}$/);
    expect(second).toMatchObject({ token: first.token, status: 'duplicate' });
    expect(first.record).toMatchObject({ tokenClass: 'learning_action', subject: binding, expiresAt: null });
    ['SC86A001', 'PHYSICS', 'VELOCITY', 'WORKSHEET'].forEach((value) => {
      expect(first.token).not.toContain(value);
    });
  });

  it('separates devices, actions, versions, and dedicated keys', () => {
    const tokens = registry();
    const a = new HmacSchoolActionTokenIssuer({ key: 'a'.repeat(32), tokens });
    const b = new HmacSchoolActionTokenIssuer({ key: 'b'.repeat(32), tokens });
    const values = new Set([
      a.tokenFor(binding),
      a.tokenFor({ ...binding, deviceId: 'SC86A002' }),
      a.tokenFor({ ...binding, actionId: 'video:velocity' }),
      a.tokenFor({ ...binding, tokenVersion: 2 }),
      b.tokenFor(binding),
    ]);
    expect(values.size).toBe(5);
  });

  it('fails closed on short keys, token collisions, and revoked versions', async () => {
    expect(() => new HmacSchoolActionTokenIssuer({ key: 'short', tokens: registry() })).toThrow(/32 bytes/);
    const collision = { claim: async (record) => ({ status: 'conflict', record }) };
    await expect(new HmacSchoolActionTokenIssuer({ key: 'x'.repeat(32), tokens: collision }).issue(binding))
      .rejects.toThrow(/collision/);
    const revoked = {
      claim: async (record) => ({ status: 'duplicate', record: { ...record, revokedAt: '2026-08-02T00:00:00Z' } }),
    };
    await expect(new HmacSchoolActionTokenIssuer({ key: 'x'.repeat(32), tokens: revoked }).issue(binding))
      .rejects.toThrow(/increment tokenVersion/);
  });
});
