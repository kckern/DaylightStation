import { describe, it, expect } from 'vitest';
import { sharePolicy, sharedUrlIn, shareIntakePaths } from './sharePolicy.mjs';

describe('sharePolicy', () => {
  it('defaults to the living-room TV with no file', () => {
    expect(sharePolicy(null)).toEqual({ defaultTarget: 'livingroom-tv', targets: [{ id: 'livingroom-tv', label: 'Living room TV' }] });
  });
  it('reads targets and a default among them', () => {
    const p = sharePolicy({ default_target: 'office-tv', targets: { 'livingroom-tv': { label: 'Living room' }, 'office-tv': {} } });
    expect(p.defaultTarget).toBe('office-tv');
    expect(p.targets).toEqual([{ id: 'livingroom-tv', label: 'Living room' }, { id: 'office-tv', label: 'office-tv' }]);
  });
  it('falls back to the first target when the default is not one', () => {
    expect(sharePolicy({ default_target: 'nope', targets: { a: {} } }).defaultTarget).toBe('a');
  });
  it('drops bad target ids', () => {
    expect(sharePolicy({ targets: { 'Bad Id': {}, ok: {} } }).targets.map((t) => t.id)).toEqual(['ok']);
  });
});

describe('sharedUrlIn', () => {
  it('finds the URL inside shared text', () => {
    expect(sharedUrlIn('Look at this! https://example.com/v?x=1, so good')).toBe('https://example.com/v?x=1');
  });
  it('null without a URL', () => {
    expect(sharedUrlIn('just words')).toBeNull();
    expect(sharedUrlIn('ftp://x')).toBeNull();
  });
});

describe('shareIntakePaths', () => {
  it('lists /text and one path per target', () => {
    expect(shareIntakePaths(sharePolicy({ targets: { a: {}, b: {} } })))
      .toEqual(['/api/v1/share/text', '/api/v1/share/to/a/text', '/api/v1/share/to/b/text']);
  });
});
