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

describe('Satellite — policy scope fields', () => {
  it('defaults scopes_allowed and scopes_denied to empty arrays', () => {
    const s = new Satellite({
      id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
    });
    assert.deepStrictEqual(s.scopes_allowed, []);
    assert.deepStrictEqual(s.scopes_denied, []);
  });

  it('accepts and freezes scopes_allowed and scopes_denied', () => {
    const s = new Satellite({
      id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
      scopes_allowed: ['memory:**', 'ha:office:**'],
      scopes_denied:  ['ha:scripts:dangerous:*'],
    });
    assert.deepStrictEqual(s.scopes_allowed, ['memory:**', 'ha:office:**']);
    assert.deepStrictEqual(s.scopes_denied, ['ha:scripts:dangerous:*']);
    assert.throws(() => s.scopes_allowed.push('x'));
    assert.throws(() => s.scopes_denied.push('x'));
  });

  it('rejects non-array scopes_allowed', () => {
    assert.throws(() =>
      new Satellite({
        id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
        scopes_allowed: 'memory:*',
      }),
      /scopes_allowed/,
    );
  });

  it('rejects non-array scopes_denied', () => {
    assert.throws(() =>
      new Satellite({
        id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
        scopes_denied: 42,
      }),
      /scopes_denied/,
    );
  });
});

describe('Satellite — media_policy field', () => {
  it('defaults media_policy to null', () => {
    const s = new Satellite({
      id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
    });
    assert.strictEqual(s.media_policy, null);
  });

  it('accepts and freezes media_policy object', () => {
    const policy = { auto_approved_libraries: [10, 11], label_gated: { libraries: [5], required_labels: ['family'] } };
    const s = new Satellite({
      id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
      media_policy: policy,
    });
    assert.deepStrictEqual(s.media_policy.auto_approved_libraries, [10, 11]);
    assert.deepStrictEqual(s.media_policy.label_gated.required_labels, ['family']);
    assert.throws(() => { s.media_policy.auto_approved_libraries.push(99); });
  });

  it('rejects non-object media_policy', () => {
    assert.throws(() =>
      new Satellite({
        id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
        media_policy: 'family',
      }),
      /media_policy/,
    );
    assert.throws(() =>
      new Satellite({
        id: 's', mediaPlayerEntity: 'media_player.x', allowedSkills: ['memory'],
        media_policy: ['family'],
      }),
      /media_policy/,
    );
  });
});
