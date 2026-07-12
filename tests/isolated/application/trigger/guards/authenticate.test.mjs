import { describe, it, expect } from 'vitest';
import { authenticate } from '#apps/trigger/guards/authenticate.mjs';

describe('authenticate', () => {
  it('passes when no token is configured', () => {
    expect(authenticate({ expectedToken: null, providedToken: undefined })).toEqual({ ok: true });
  });
  it('passes when tokens match', () => {
    expect(authenticate({ expectedToken: 'abc', providedToken: 'abc' })).toEqual({ ok: true });
  });
  it('fails when tokens differ', () => {
    expect(authenticate({ expectedToken: 'abc', providedToken: 'x' })).toEqual({ ok: false, code: 'AUTH_FAILED' });
  });
});
