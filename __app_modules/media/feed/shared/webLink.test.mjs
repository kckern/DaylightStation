import { describe, it, expect } from 'vitest';
import { webLink, frameableLink, externalImageLink, feedImageSrc } from './webLink.mjs';

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

describe('externalImageLink: an image URL from someone else\'s feed, at ingest', () => {
  it('keeps an http(s) image on any host', () => {
    expect(externalImageLink('https://cdn.example/pic.jpg')).toBe('https://cdn.example/pic.jpg');
  });

  it('drops relative URLs, other schemes, and any URL into /api or /admin on any host', () => {
    for (const bad of ['/api/v1/home/script/run', 'data:image/png;base64,AA', 'javascript:x',
      'https://app.example.test/api/v1/admin/x', 'http://192.0.2.10:3111/API/v1/x', 'https://x.example/admin', 'https://x.example/%61pi/x']) {
      expect(externalImageLink(bad), bad).toBeNull();
    }
  });
});

describe('feedImageSrc: what an <img> in the feed may load', () => {
  const app = 'https://app.example.test';

  it('keeps the read-only image endpoints the app\'s own feed sources use', () => {
    for (const path of [
      '/api/v1/proxy/immich/assets/abc/thumbnail?size=preview',
      '/api/v1/proxy/plex/library/metadata/123/thumb?w=120',
      '/api/v1/proxy/komga/composite/b/1',
      '/api/v1/proxy/reddit/i.redd.it/x.jpg',
      '/api/v1/proxy/abs/items/9/cover',
      '/api/v1/static/img/users/kc',
      '/api/v1/feed/icon?url=https%3A%2F%2Fx',
      '/api/v1/feed/image?url=https%3A%2F%2Fx',
    ]) {
      expect(feedImageSrc(path, app), path).toBe(path);
      expect(feedImageSrc(`${app}${path}`, app), path).toBe(`${app}${path}`);
    }
  });

  it('refuses any other path on the app\'s own origin, however it is spelled', () => {
    for (const path of ['/api/v1/home/script/run', '/API/v1/admin/x', '/admin', '/fitness', '//api/v1/x',
      '/api/v1/proxy/immich/assets/../../../admin/x', '/api/v1/proxy/immich/assets/%2e%2e/%2e%2e/%2e%2e/admin',
      '/api/v1/proxy/plex/:/scrobble?key=1', 'api/v1/proxy/immich/assets/x']) {
      expect(feedImageSrc(path, app), path).toBeNull();
      if (path.startsWith('/')) expect(feedImageSrc(`${app}${path}`, app), `abs ${path}`).toBeNull();
    }
  });

  it('keeps an image on another host, and routes one whose path is /api or /admin through the image proxy', () => {
    expect(feedImageSrc('https://cdn.example/pic.jpg', app)).toBe('https://cdn.example/pic.jpg');
    expect(feedImageSrc('http://192.0.2.10:3111/api/v1/home/x', app))
      .toBe(`/api/v1/feed/image?url=${encodeURIComponent('http://192.0.2.10:3111/api/v1/home/x')}`);
  });

  it('keeps inline image data and refuses other schemes', () => {
    expect(feedImageSrc('data:image/png;base64,AA', app)).toBe('data:image/png;base64,AA');
    for (const bad of ['javascript:x', 'data:text/html,x', 'file:///x', '', null, undefined]) {
      expect(feedImageSrc(bad, app), String(bad)).toBeNull();
    }
  });
});
