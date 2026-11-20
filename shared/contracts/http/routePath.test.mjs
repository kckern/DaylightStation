import { describe, it, expect } from 'vitest';
import { canonicalRoutePath, routePathWithin } from './routePath.mjs';

describe('canonicalRoutePath: one spelling for every path Express would route the same way', () => {
  it('lower-cases (Express routes case-insensitively)', () => {
    expect(canonicalRoutePath('/API/V1/Admin/Thing')).toBe('/api/v1/admin/thing');
  });

  it('decodes percent-encoded characters, collapses repeated slashes, drops trailing slashes and dots', () => {
    expect(canonicalRoutePath('/%61pi/v1/%41dmin')).toBe('/api/v1/admin');
    expect(canonicalRoutePath('//api///v1/admin/')).toBe('/api/v1/admin');
    expect(canonicalRoutePath('/api./v1/admin..')).toBe('/api/v1/admin');
    expect(canonicalRoutePath('/api%2Fv1')).toBe('/api/v1');
  });

  it('survives malformed encodings and empties', () => {
    expect(canonicalRoutePath('/api/%E0%A4%A')).toBe('/api/%e0%a4%a');
    expect(canonicalRoutePath('')).toBe('/');
    expect(canonicalRoutePath(undefined)).toBe('/');
    expect(canonicalRoutePath('/')).toBe('/');
  });
});

describe('routePathWithin', () => {
  it('matches the prefix itself and anything below it, in any spelling', () => {
    for (const path of ['/api', '/API', '/api/', '/Api/V1/x', '//api/v1', '/%61pi/v1']) {
      expect(routePathWithin(path, '/api'), path).toBe(true);
    }
  });

  it('does not match a longer segment', () => {
    expect(routePathWithin('/apis', '/api')).toBe(false);
    expect(routePathWithin('/administrator', '/admin')).toBe(false);
  });
});
