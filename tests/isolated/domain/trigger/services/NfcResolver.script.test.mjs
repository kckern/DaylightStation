import { describe, it, expect } from 'vitest';
import { NfcResolver } from '#domains/trigger/services/NfcResolver.mjs';

describe('NfcResolver script', () => {
  it('resolves an endpoint tag to a script intent (endpoint not leaked to params)', () => {
    const registry = {
      locations: { lr: { target: 'x', defaults: {} } },
      tags: { aa: { global: { action: 'script', endpoint: 'bedtime', foo: 'bar' }, overrides: {} } },
    };
    const intent = NfcResolver.resolve({
      location: 'lr',
      value: 'aa',
      registry,
      contentIdResolver: { resolve: () => false },
    });
    expect(intent.action).toBe('script');
    expect(intent.endpoint).toBe('bedtime');
    expect(intent.params.foo).toBe('bar');
    expect(intent.params.endpoint).toBeUndefined();
  });
});
