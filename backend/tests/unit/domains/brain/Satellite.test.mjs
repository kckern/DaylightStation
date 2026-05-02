import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Satellite } from '../../../../src/2_domains/brain/Satellite.mjs';

describe('Satellite', () => {
  const valid = {
    id: 'livingroom',
    mediaPlayerEntity: 'media_player.living_room',
    area: 'livingroom',
    allowedSkills: ['memory', 'home_automation'],
    defaultVolume: 30,
    defaultMediaClass: 'music',
  };

  it('constructs with valid fields', () => {
    const s = new Satellite(valid);
    assert.strictEqual(s.id, 'livingroom');
    assert.strictEqual(s.mediaPlayerEntity, 'media_player.living_room');
  });

  it('rejects empty allowedSkills', () => {
    assert.throws(() => new Satellite({ ...valid, allowedSkills: [] }), /allowedSkills/);
  });

  it('rejects missing mediaPlayerEntity', () => {
    assert.throws(() => new Satellite({ ...valid, mediaPlayerEntity: null }), /mediaPlayerEntity/);
  });

  it('canUseSkill returns true for allowed skills', () => {
    const s = new Satellite(valid);
    assert.strictEqual(s.canUseSkill('memory'), true);
    assert.strictEqual(s.canUseSkill('finance_read'), false);
  });

  it('mediaPlayerFor returns the configured entity', () => {
    const s = new Satellite(valid);
    assert.strictEqual(s.mediaPlayerFor(), 'media_player.living_room');
  });
});
