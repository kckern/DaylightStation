import { describe, expect, it } from 'vitest';
import {
  classifySchoolCalcDeliveryClaim,
  validateSchoolCalcDeliveryRequest,
} from './delivery.mjs';

describe('SchoolCalc delivery request rules', () => {
  it('accepts install by learning address and remove by immutable artifact', () => {
    expect(validateSchoolCalcDeliveryRequest({
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 4, learnerKey: 1,
      action: 'install', address: 'main/markets/finance/interest/compound-growth',
    }).errors).toEqual([]);
    expect(validateSchoolCalcDeliveryRequest({
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 5, learnerKey: 1,
      action: 'remove', artifactId: 'sc:ti86:ABC234DEFG',
    }).errors).toEqual([]);
  });

  it('does not let an install request choose server compilation output', () => {
    expect(validateSchoolCalcDeliveryRequest({
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 4, learnerKey: 1,
      action: 'install', address: 'main/markets/finance/interest/compound-growth',
      artifactId: 'attacker-choice',
    }).errors).toContain('install request must not choose an artifactId');
  });

  it('accepts an install-set selector and exact multi-artifact removal', () => {
    expect(validateSchoolCalcDeliveryRequest({
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 6, learnerKey: 1,
      action: 'install', installSet: { catalogId: 'main', installSetId: 'starter' },
    }).errors).toEqual([]);
    expect(validateSchoolCalcDeliveryRequest({
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 7, learnerKey: 1,
      action: 'remove', artifactIds: ['sc:future:ONE', 'sc:future:TWO'],
    }).errors).toEqual([]);
    expect(validateSchoolCalcDeliveryRequest({
      schema: 'school.calc.delivery-request/v1', deviceId: '86A001', requestId: 8, learnerKey: 1,
      action: 'install', address: 'main/a/b/c/d', installSet: { catalogId: 'main', installSetId: 'starter' },
    }).errors).toContain('install request must choose exactly one lesson address or installSet');
  });

  it('detects replay and changed-payload request collisions', () => {
    expect(classifySchoolCalcDeliveryClaim({ incomingDigest: 'a' })).toBe('new');
    expect(classifySchoolCalcDeliveryClaim({ existingDigest: 'a', incomingDigest: 'a' })).toBe('duplicate');
    expect(classifySchoolCalcDeliveryClaim({ existingDigest: 'a', incomingDigest: 'b' })).toBe('conflict');
  });
});
