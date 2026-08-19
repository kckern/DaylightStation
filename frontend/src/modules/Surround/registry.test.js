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
    registerSurroundModule('movement-map', Dummy);
    const registry = getSurroundRegistry();
    expect(registry.has('movement-map')).toBe(true);
    expect(registry.get('movement-map')).toBe(Dummy);
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
    registerSurroundModule('movement-map', Dummy);
    registerSurroundModule('cue-ticker', Other);
    expect(getSurroundRegistry().list().sort()).toEqual(['cue-ticker', 'movement-map']);
  });

  it('is a separate instance from the screen widget registry', () => {
    expect(getSurroundRegistry()).not.toBe(getWidgetRegistry());
  });

  it('does not leak surround modules into the screen widget registry', () => {
    registerSurroundModule('movement-map', Dummy);
    expect(getWidgetRegistry().has('movement-map')).toBe(false);
    expect(getWidgetRegistry().get('movement-map')).toBeNull();
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

  it('imports without throwing and registers only known builtin names', async () => {
    const builtins = await import('./builtins.js');
    builtins.registerSurroundBuiltins();
    const registered = getSurroundRegistry().list();
    registered.forEach((name) => {
      expect(builtins.SURROUND_BUILTIN_MODULES).toContain(name);
    });
  });

  it('declares the three modules the frame resolves by name', async () => {
    const { SURROUND_BUILTIN_MODULES } = await import('./builtins.js');
    expect([...SURROUND_BUILTIN_MODULES].sort())
      .toEqual(['composer-card', 'cue-ticker', 'movement-map']);
  });
});
