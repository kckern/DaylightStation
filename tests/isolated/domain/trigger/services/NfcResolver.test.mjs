import { describe, it, expect } from 'vitest';
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';

const makeContentIdResolver = () => ({
  resolve: (compound) => compound.startsWith('plex:') ? compound : null,
});

const baseRegistry = {
  locations: {
    livingroom: {
      target: 'livingroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: { shader: 'default', volume: 15 },
    },
    bedroom: {
      target: 'bedroom-tv',
      action: 'play-next',
      auth_token: null,
      defaults: { shader: 'blackout', volume: 8 },
    },
  },
  tags: {
    '838e6806': { global: { plex: 620707 }, overrides: {} },
    'aabb': {
      global: { plex: 100, shader: 'focused' },
      overrides: {
        bedroom: { shader: 'night', volume: 5 },
      },
    },
  },
};

describe('NfcResolver', () => {
  const contentIdResolver = makeContentIdResolver();

  it('returns null when location is not registered', () => {
    const result = NfcResolver.resolve({
      location: 'unknown',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toBeNull();
  });

  it('returns null when tag UID is not registered', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'unknown_tag',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toBeNull();
  });

  it('produces an intent for a minimal tag using reader defaults', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8e_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result).toEqual({
      action: 'play-next',
      target: 'livingroom-tv',
      // The READER, not the screen. Two readers can point at one target, so
      // the room has to be its own field for the reading-session interceptor
      // to scope a claim by it.
      location: 'livingroom',
      content: 'plex:620707',
      params: { shader: 'default', volume: 15 },
    });
  });

  it('merges reader-defaults < tag-global, with tag-global winning on collision', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('focused');
    expect(result.params.volume).toBe(15);
  });

  it('merges reader-defaults < tag-global < tag-override-for-location, with override winning', () => {
    const result = NfcResolver.resolve({
      location: 'bedroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('night');
    expect(result.params.volume).toBe(5);
    expect(result.target).toBe('bedroom-tv');
  });

  it('does not apply overrides for other locations', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'aa_bb',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.shader).toBe('focused');
    expect(result.target).toBe('livingroom-tv');
  });

  it('allows tag-global to override action and target', () => {
    const registry = {
      locations: {
        livingroom: { target: 'livingroom-tv', action: 'play-next', defaults: {} },
      },
      tags: {
        'overridetag': {
          global: { plex: 100, action: 'queue', target: 'kitchen-display' },
          overrides: {},
        },
      },
    };
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: 'override_tag',
      registry,
      contentIdResolver,
    });
    expect(result.action).toBe('queue');
    expect(result.target).toBe('kitchen-display');
  });

  it('lowercases the input value before lookup', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8E_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result?.content).toBe('plex:620707');
  });

  it('throws when shorthand expansion finds multiple resolvable content prefixes', () => {
    const registry = {
      locations: { livingroom: { target: 'tv', action: 'play', defaults: {} } },
      tags: {
        'ambiguous': { global: { plex: 1, files: 'x' }, overrides: {} },
      },
    };
    // Both `plex:` and `files:` resolve as content per this special resolver.
    const ambiguousResolver = { resolve: (c) => c.startsWith('plex:') || c.startsWith('files:') };
    expect(() => NfcResolver.resolve({
      location: 'livingroom',
      value: 'ambiguous',
      registry,
      contentIdResolver: ambiguousResolver,
    })).toThrow(/shorthand/i);
  });

  it('does not include consumed shorthand key in params', () => {
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '83_8e_68_06',
      registry: baseRegistry,
      contentIdResolver,
    });
    expect(result.params.plex).toBeUndefined();
  });
});

describe('NfcResolver — metadata-only tags', () => {
  function makeRegistry(tags = {}) {
    return {
      locations: {
        livingroom: {
          target: 'livingroom-tv',
          action: 'play-next',
          defaults: {},
        },
      },
      tags,
    };
  }
  const resolver = { resolve: (id) => /^plex:/.test(id) ? { source: 'plex' } : null };

  it('returns null for a tag with only scanned_at (placeholder, state 1)', () => {
    const registry = makeRegistry({
      '04a1b2c3': { global: { scanned_at: '2026-04-26 10:00:00' }, overrides: {} },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04_a1_b2_c3',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).toBeNull();
  });

  it('returns null for a tag with scanned_at + note (state 2)', () => {
    const registry = makeRegistry({
      '04a1b2c3': {
        global: { scanned_at: '2026-04-26 10:00:00', note: 'kids movie' },
        overrides: {},
      },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04_a1_b2_c3',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).toBeNull();
  });

  it('returns intent for a scene-only tag (no content, state 3)', () => {
    const registry = makeRegistry({
      '04doorkey1': { global: { scene: 'scene.welcome_home' }, overrides: {} },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04doorkey1',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).not.toBeNull();
    expect(result.scene).toBe('scene.welcome_home');
  });

  it('returns intent for a ha-service tag (no content, state 3)', () => {
    const registry = makeRegistry({
      '04light': { global: { service: 'turn_on', entity: 'light.kitchen' }, overrides: {} },
    });
    const result = NfcResolver.resolve({
      location: 'livingroom',
      value: '04light',
      registry,
      contentIdResolver: resolver,
    });
    expect(result).not.toBeNull();
    expect(result.service).toBe('turn_on');
    expect(result.entity).toBe('light.kitchen');
  });

  describe('tag metadata exclusion', () => {
    it('scanned_at and note do not leak into intent.params', () => {
      const registry = {
        locations: { livingroom: { action: 'play-next', target: 'livingroom-tv' } },
        tags: {
          '0428d471cc2a81': {
            global: { scanned_at: '2026-05-10 11:51:19', note: 'Eyes shuts', plex: '621568' },
            overrides: {},
          },
        },
      };
      const intent = NfcResolver.resolve({
        location: 'livingroom', value: '04_28_D4_71_CC_2A_81',
        registry, contentIdResolver: makeContentIdResolver(),
      });
      expect(intent).not.toBeNull();
      expect(intent.content).toBe('plex:621568');
      expect(intent.params).not.toHaveProperty('scanned_at');
      expect(intent.params).not.toHaveProperty('note');
    });

    it('metadata-only tag still resolves to null (unknown-tag capture flow)', () => {
      const registry = {
        locations: { livingroom: { action: 'play-next', target: 'livingroom-tv' } },
        tags: { 'aabb': { global: { scanned_at: '2026-01-01 00:00:00', note: 'unnamed' }, overrides: {} } },
      };
      const intent = NfcResolver.resolve({
        location: 'livingroom', value: 'aa_bb',
        registry, contentIdResolver: makeContentIdResolver(),
      });
      expect(intent).toBeNull();
    });
  });
});

describe('school learner cards', () => {
  const registry = {
    locations: {
      study: { target: 'portal', action: 'play-next', learner_action: 'print-agenda', defaults: {} },
      livingroom: { target: 'livingroom-tv', action: 'play-next', learner_action: 'reading-session', defaults: {} },
      office: { target: 'office-tv', action: 'play-next', learner_action: null, defaults: {} },
    },
    tags: {
      '048ba600cc2a81': { global: { note: 'learner-a personal card', school_learner: 'learner-a' }, overrides: {} },
    },
  };

  it('resolves to the reader location learner_action, carrying the learner', () => {
    const intent = NfcResolver.resolve({
      location: 'study', value: '04:8B:A6:00:CC:2A:81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent).toMatchObject({ action: 'print-agenda', learnerId: 'learner-a' });
  });

  it('carries the reader it was tapped at, since the reader is part of the answer', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.location).toBe('livingroom');
  });

  it('gives the SAME card a different action at a different reader', () => {
    const intent = NfcResolver.resolve({
      location: 'livingroom', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.action).toBe('reading-session');
    expect(intent.learnerId).toBe('learner-a');
  });

  it('resolves to null at a reader that declares no learner_action', () => {
    expect(NfcResolver.resolve({
      location: 'office', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    })).toBeNull();
  });

  it('never leaks school_learner into params', () => {
    const intent = NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.params).not.toHaveProperty('school_learner');
  });
});

describe('school learner cards — config-surface guards', () => {
  const learnerRegistry = (locations, tagGlobal) => ({
    locations,
    tags: { '048ba600cc2a81': { global: tagGlobal, overrides: {} } },
  });

  // A learner card is a TAG fact. Reading it from `merged` would let a
  // `school_learner` written on the SOURCE entry (which the adapter drops into
  // `defaults`) hijack every tag at that reader — a book sticker would resolve
  // as a learner card with its content thrown away.
  it('ignores school_learner coming from the reader defaults', () => {
    const registry = {
      locations: {
        study: {
          target: 'portal', action: 'play-next', learner_action: 'print-agenda',
          defaults: { school_learner: 'learner-b' },
        },
      },
      tags: { 'b00c': { global: { plex: 999 }, overrides: {} } },
    };
    const intent = NfcResolver.resolve({
      location: 'study', value: 'b0_0c', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.content).toBe('plex:999');
    expect(intent).not.toHaveProperty('learnerId');
    expect(intent.action).toBe('play-next');
  });

  it('honours a per-reader override of school_learner on the tag', () => {
    const registry = {
      locations: { study: { target: 'portal', learner_action: 'print-agenda', defaults: {} } },
      tags: {
        '048ba600cc2a81': {
          global: { school_learner: 'learner-a' },
          overrides: { study: { school_learner: 'learner-c' } },
        },
      },
    };
    const intent = NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.learnerId).toBe('learner-c');
  });

  it('accepts an unquoted numeric learner id as a string', () => {
    const intent = NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81',
      registry: learnerRegistry(
        { study: { target: 'portal', learner_action: 'print-agenda', defaults: {} } },
        { school_learner: 42 }
      ),
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.learnerId).toBe('42');
  });

  // String() would mint "a,b" / "[object Object]" / "" and carry them all the
  // way into a personal-card URL, where the 404 says nothing about the YAML
  // line that caused it. Refuse at the boundary instead.
  it.each([
    ['an array', ['learner-a', 'learner-b']],
    ['an object', { id: 'learner-a' }],
    ['a boolean', true],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('throws INVALID_SCHOOL_LEARNER for %s', (_label, value) => {
    const registry = learnerRegistry(
      { study: { target: 'portal', learner_action: 'print-agenda', defaults: {} } },
      { school_learner: value }
    );
    expect(() => NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81', registry,
      contentIdResolver: makeContentIdResolver(),
    })).toThrow(/school_learner/i);
  });

  it('trims a padded learner id', () => {
    const intent = NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81',
      registry: learnerRegistry(
        { study: { target: 'portal', learner_action: 'print-agenda', defaults: {} } },
        { school_learner: '  learner-a  ' }
      ),
      contentIdResolver: makeContentIdResolver(),
    });
    expect(intent.learnerId).toBe('learner-a');
  });

  // INVARIANT, and the reason these defaults are deliberately non-empty: the
  // learner branch must run BEFORE content resolution. Move it below and this
  // card throws AMBIGUOUS_SHORTHAND out of the reader's own defaults — with a
  // single-prefix resolver stub the same drift merely passes through silently,
  // so the stub here resolves both prefixes on purpose.
  it('resolves a learner card at a reader whose defaults carry two content-resolvable keys', () => {
    const registry = {
      locations: {
        study: {
          target: 'portal', action: 'play-next', learner_action: 'print-agenda',
          defaults: { plex: 620707, files: 'chime.mp3' },
        },
      },
      tags: { '048ba600cc2a81': { global: { school_learner: 'learner-a' }, overrides: {} } },
    };
    const bothResolve = { resolve: (c) => /^(plex|files):/.test(c) ? c : null };
    const intent = NfcResolver.resolve({
      location: 'study', value: '048ba600cc2a81', registry,
      contentIdResolver: bothResolve,
    });
    expect(intent).toMatchObject({ action: 'print-agenda', learnerId: 'learner-a' });
    expect(intent).not.toHaveProperty('content');
  });
});
