import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as ports from '../../../../src/3_applications/concierge/ports/index.mjs';

describe('concierge ports module', () => {
  it('exports all assertion helpers', () => {
    for (const name of [
      'assertSkill',
      'assertSatelliteRegistry',
      'assertConciergePolicy',
      'assertConciergeMemory',
      'assertChatCompletionRunner',
    ]) {
      assert.strictEqual(typeof ports[name], 'function', `${name} missing`);
    }
  });

  it('isSkill returns true for a valid shape', () => {
    const skill = {
      name: 's',
      getTools: () => [],
      getPromptFragment: () => '',
      getConfig: () => ({}),
    };
    assert.strictEqual(ports.isSkill(skill), true);
    assert.strictEqual(ports.isSkill({}), false);
  });
});
