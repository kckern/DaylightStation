import { describe, it, expect } from 'vitest';
import { isToolBundle, assertToolBundle, ToolBundle } from './ToolBundle.mjs';

describe('isToolBundle', () => {
  it('returns false for null', () => {
    expect(isToolBundle(null)).toBe(false);
  });

  it('returns false when name is missing', () => {
    expect(isToolBundle({ createTools: () => [] })).toBe(false);
  });

  it('returns false when createTools is not a function', () => {
    expect(isToolBundle({ name: 'x', createTools: 'nope' })).toBe(false);
  });

  it('returns true for minimal valid bundle', () => {
    expect(isToolBundle({ name: 'memory', createTools: () => [] })).toBe(true);
  });

  it('returns true when optional methods are present', () => {
    expect(isToolBundle({
      name: 'media',
      createTools: () => [],
      getPromptFragment: () => '## media',
      getConfig: () => ({}),
    })).toBe(true);
  });
});

describe('assertToolBundle', () => {
  it('throws on invalid bundle', () => {
    expect(() => assertToolBundle({})).toThrow('ToolBundle');
  });

  it('does not throw on valid bundle', () => {
    expect(() => assertToolBundle({ name: 'x', createTools: () => [] })).not.toThrow();
  });
});

describe('ToolBundle base class', () => {
  class ConcreteBundle extends ToolBundle {
    static bundleName = 'test';
    createTools() { return [{ name: 'noop', description: 'd', parameters: {}, execute: async () => ({}) }]; }
  }

  it('createTools returns the overridden tools', () => {
    const b = new ConcreteBundle({});
    expect(b.createTools()).toHaveLength(1);
    expect(b.createTools()[0].name).toBe('noop');
  });

  it('getPromptFragment returns null by default', () => {
    const b = new ConcreteBundle({});
    expect(b.getPromptFragment({})).toBeNull();
  });

  it('getConfig returns empty object by default', () => {
    const b = new ConcreteBundle({});
    expect(b.getConfig()).toEqual({});
  });

  it('name getter returns static bundleName', () => {
    const b = new ConcreteBundle({});
    expect(b.name).toBe('test');
  });
});
