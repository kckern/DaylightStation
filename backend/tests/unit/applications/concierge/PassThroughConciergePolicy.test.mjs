import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PassThroughConciergePolicy } from '../../../../src/3_applications/concierge/services/PassThroughConciergePolicy.mjs';

describe('PassThroughConciergePolicy', () => {
  const p = new PassThroughConciergePolicy();
  it('evaluateRequest allows', () => {
    const d = p.evaluateRequest({}, {});
    assert.strictEqual(d.allow, true);
  });
  it('evaluateToolCall allows', () => {
    const d = p.evaluateToolCall({}, 'any', {});
    assert.strictEqual(d.allow, true);
  });
  it('shapeResponse returns input unchanged', () => {
    assert.strictEqual(p.shapeResponse({}, 'hi'), 'hi');
  });
});
