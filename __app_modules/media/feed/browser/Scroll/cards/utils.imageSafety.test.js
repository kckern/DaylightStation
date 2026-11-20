import { describe, it, expect } from 'vitest';
import { safeImage, proxyImage, proxyIcon } from './utils.js';

const here = () => window.location.origin;

describe('feed image helpers never point an <img> at an action route on this app', () => {
  it('safeImage keeps the app\'s read-only image endpoints and external images', () => {
    expect(safeImage('/api/v1/proxy/immich/assets/a/thumbnail')).toBe('/api/v1/proxy/immich/assets/a/thumbnail');
    expect(safeImage('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
  });

  it('safeImage refuses other app paths, in any spelling, on this origin', () => {
    for (const url of ['/api/v1/home/script/run', '/API/v1/admin/x', `${here()}/api/v1/admin/x`, 'javascript:x', '/api/v1/proxy/immich/assets/../../admin']) {
      expect(safeImage(url), url).toBeNull();
    }
  });

  it('proxyImage proxies only external http(s) URLs, never a path on this app', () => {
    expect(proxyImage('https://cdn.example/x.jpg')).toBe(`/api/v1/feed/image?url=${encodeURIComponent('https://cdn.example/x.jpg')}`);
    for (const url of ['/api/v1/home/x', '/fitness', 'javascript:x', `${here()}/api/v1/proxy/immich/assets/a`]) {
      expect(proxyImage(url), url).toBeNull();
    }
  });

  it('proxyIcon passes the app\'s own icon paths, proxies external ones, refuses the rest', () => {
    expect(proxyIcon('/api/v1/feed/icon?url=x')).toBe('/api/v1/feed/icon?url=x');
    expect(proxyIcon('https://immich.app')).toBe(`/api/v1/feed/icon?url=${encodeURIComponent('https://immich.app')}`);
    for (const url of ['/api/v1/home/x', '/API/v1/admin', 'javascript:x']) {
      expect(proxyIcon(url), url).toBeNull();
    }
  });
});
