import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getSurroundRegistry,
  registerSurroundModule,
  resetSurroundRegistry,
} from './registry.js';
import { getWidgetRegistry, resetWidgetRegistry } from '../../screen-framework/widgets/registry.js';

const Dummy = () => null;
const Other = () => null;

describe('surround module registry', () => {
  beforeEach(() => {
    resetSurroundRegistry();
    resetWidgetRegistry();
  });
  afterEach(() => {
    resetSurroundRegistry();
    resetWidgetRegistry();
  });

  it('round-trips register / has / get', () => {
    registerSurroundModule('segment-map', Dummy);
    const registry = getSurroundRegistry();
    expect(registry.has('segment-map')).toBe(true);
    expect(registry.get('segment-map')).toBe(Dummy);
  });

  it('returns null (not undefined) for an unknown module and does not throw', () => {
    const registry = getSurroundRegistry();
    expect(registry.has('nope')).toBe(false);
    expect(() => registry.get('nope')).not.toThrow();
    expect(registry.get('nope')).toBeNull();
  });

  it('returns the same instance across calls', () => {
    expect(getSurroundRegistry()).toBe(getSurroundRegistry());
  });

  it('carries optional meta alongside the component', () => {
    registerSurroundModule('cue-ticker', Dummy, { regions: ['footer'] });
    expect(getSurroundRegistry().getMeta('cue-ticker')).toEqual({ regions: ['footer'] });
  });

  it('lists registered module names', () => {
    registerSurroundModule('segment-map', Dummy);
    registerSurroundModule('cue-ticker', Other);
    expect(getSurroundRegistry().list().sort()).toEqual(['cue-ticker', 'segment-map']);
  });

  it('is a separate instance from the screen widget registry', () => {
    expect(getSurroundRegistry()).not.toBe(getWidgetRegistry());
  });

  it('does not leak surround modules into the screen widget registry', () => {
    registerSurroundModule('segment-map', Dummy);
    expect(getWidgetRegistry().has('segment-map')).toBe(false);
    expect(getWidgetRegistry().get('segment-map')).toBeNull();
  });

  it('does not pick up screen widgets registered on the shared screen registry', () => {
    getWidgetRegistry().register('clock', Other);
    expect(getSurroundRegistry().has('clock')).toBe(false);
    expect(getSurroundRegistry().get('clock')).toBeNull();
  });
});

describe('surround builtins', () => {
  beforeEach(() => { resetSurroundRegistry(); });
  afterEach(() => { resetSurroundRegistry(); });

  // AN EXACT SET, IN BOTH DIRECTIONS. This asserted subset membership — every
  // registered name is a known builtin — which is the direction that cannot
  // fail: delete a registration from `registerSurroundBuiltins` and the set
  // only shrinks, so both registry specs stayed green while the frame lost a
  // module. The declaration and the registrations have to be the same set.
  it('registers exactly the builtin names it declares', async () => {
    const builtins = await import('./builtins.js');
    builtins.registerSurroundBuiltins();
    expect(getSurroundRegistry().list().sort())
      .toEqual([...builtins.SURROUND_BUILTIN_MODULES].sort());
  });

  it('gives every builtin a real component and its declared regions', async () => {
    const builtins = await import('./builtins.js');
    builtins.registerSurroundBuiltins();
    const registry = getSurroundRegistry();
    builtins.SURROUND_BUILTIN_MODULES.forEach((name) => {
      expect(typeof registry.get(name), `${name} resolves to no component`).toBe('function');
      const slots = registry.getMeta(name)?.regions;
      expect(Array.isArray(slots) && slots.length > 0, `${name} declares no regions`).toBe(true);
    });
  });

  // Asserts the exact SET, not a count: a count tolerates a module being
  // registered under a wrong name as long as the total is right, which is the
  // one failure a definition's `module:` reference cannot survive.
  it('declares the modules the frame resolves by name', async () => {
    const { SURROUND_BUILTIN_MODULES } = await import('./builtins.js');
    expect([...SURROUND_BUILTIN_MODULES].sort())
      .toEqual([
        'composer-card', 'country-map', 'cue-ticker', 'movement-map',
        'place-carousel', 'script-rail', 'segment-map', 'work-placard',
      ]);
  });

  // The definition YAML in the data volume is hand-authored and names the rail
  // module. `movement-map` was that name until the vocabulary was unified, so
  // it has to keep resolving — to the SAME component, not a stub — or an
  // unmigrated `_surrounds/*.yml` renders an empty region and warns
  // `surround.module.missing` instead of drawing the rail.
  it('resolves the legacy movement-map name to the same component as segment-map', async () => {
    const builtins = await import('./builtins.js');
    builtins.registerSurroundBuiltins();
    const registry = getSurroundRegistry();
    expect(builtins.LEGACY_MODULE_ALIASES['movement-map']).toBe('segment-map');
    expect(registry.get('movement-map')).toBe(registry.get('segment-map'));
    expect(registry.getMeta('movement-map')).toEqual(registry.getMeta('segment-map'));
  });

  // OVER THE WHOLE TABLE, not just today's one row. The registration loop used
  // to carry an `if (name === 'segment-map')` guard, so a second alias would
  // have been declared, listed, and silently never registered — a blank region
  // for the one definition nobody had migrated yet, which is precisely what the
  // alias mechanism exists to prevent. These two specs are what make the loop's
  // generality real rather than asserted in a comment.
  it('registers every alias in the table against its target module', async () => {
    const builtins = await import('./builtins.js');
    builtins.registerSurroundBuiltins();
    const registry = getSurroundRegistry();
    const aliases = Object.entries(builtins.LEGACY_MODULE_ALIASES);
    expect(aliases.length).toBeGreaterThan(0);
    aliases.forEach(([alias, name]) => {
      expect(registry.get(name), `alias ${alias} names ${name}, which is not a builtin`)
        .toEqual(expect.any(Function));
      expect(registry.get(alias), `${alias} does not resolve to ${name}'s component`)
        .toBe(registry.get(name));
      expect(registry.getMeta(alias), `${alias} does not carry ${name}'s regions meta`)
        .toEqual(registry.getMeta(name));
    });
  });

  it('declares every alias among the names the frame resolves', async () => {
    const { SURROUND_BUILTIN_MODULES, LEGACY_MODULE_ALIASES } = await import('./builtins.js');
    Object.keys(LEGACY_MODULE_ALIASES).forEach((alias) => {
      expect(SURROUND_BUILTIN_MODULES, `${alias} is registered but not declared`).toContain(alias);
    });
  });
});
