import { describe, it, expect } from 'vitest';
import { webLink, frameableLink } from './webLink.mjs';

describe('webLink: a feed link is usable only as an absolute http(s) URL', () => {
  it('keeps http and https links, trimmed', () => {
    expect(webLink(' https://news.example/a?b=1#c ')).toBe('https://news.example/a?b=1#c');
    expect(webLink('http://news.example/')).toBe('http://news.example/');
  });

  it('drops every other scheme, relative paths and junk', () => {
    for (const bad of [
      'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>1</script>',
      'vbscript:x', 'file:///etc/passwd', 'blob:https://x/y', '/api/v1/admin/x', '//evil.example/x',
      'about:blank', '', null, undefined, 42, {},
    ]) {
      expect(webLink(bad), String(bad)).toBeNull();
    }
  });
});

describe('frameableLink: a link may fill a scripts+same-origin sandboxed iframe only off the app\'s origin', () => {
  const app = 'https://app.example.test';

  it('keeps a link on another origin', () => {
    expect(frameableLink('https://news.example/a', app)).toBe('https://news.example/a');
  });

  it('refuses a link on the app\'s own origin (it would run with the app\'s privileges)', () => {
    expect(frameableLink('https://app.example.test/api/v1/admin/x', app)).toBeNull();
    expect(frameableLink('HTTPS://APP.example.test:443/', app)).toBeNull();
  });

  it('keeps another port or scheme on the same host (a different origin)', () => {
    expect(frameableLink('https://app.example.test:8443/', app)).toBe('https://app.example.test:8443/');
  });

  it('refuses non-web links', () => {
    expect(frameableLink('javascript:alert(1)', app)).toBeNull();
  });
});
