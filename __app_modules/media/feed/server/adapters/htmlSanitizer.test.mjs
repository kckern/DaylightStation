import { describe, it, expect } from 'vitest';
import { sanitizeFeedHtml } from './htmlSanitizer.mjs';

describe('sanitizeFeedHtml: feed HTML loads and links only outside the app', () => {
  it('drops an image that is relative, protocol-relative, or into /api or /admin', () => {
    for (const src of ['/api/v1/home/script/run', '//app.example.test/api/v1/x', 'https://app.example.test/API/v1/admin/x', 'images/x.jpg']) {
      expect(sanitizeFeedHtml(`<p>a<img src="${src}" alt="x">b</p>`), src).toBe('<p>ab</p>');
    }
  });

  it('keeps an http(s) image elsewhere', () => {
    expect(sanitizeFeedHtml('<img src="https://cdn.example/pic.jpg" alt="x">')).toBe('<img alt="x" src="https://cdn.example/pic.jpg" />');
  });

  it('removes a relative or non-web href but keeps the text', () => {
    for (const href of ['/api/v1/home/script/run', '//evil.example/x', 'javascript:alert(1)']) {
      expect(sanitizeFeedHtml(`<a href="${href}">read</a>`), href).toBe('<a target="_blank" rel="noopener noreferrer nofollow">read</a>');
    }
    expect(sanitizeFeedHtml('<a href="https://news.example/a">read</a>')).toContain('href="https://news.example/a"');
  });
});
