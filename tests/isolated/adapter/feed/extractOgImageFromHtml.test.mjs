import { describe, test, expect } from 'vitest';
import { extractOgImageFromHtml } from '#adapters/feed/WebContentAdapter.mjs';

describe('extractOgImageFromHtml', () => {
  test('reads og:image with property before content', () => {
    const html = '<html><head><meta property="og:image" content="https://x.com/a.jpg"></head><body></body></html>';
    expect(extractOgImageFromHtml(html)).toBe('https://x.com/a.jpg');
  });

  test('reads og:image with content before property', () => {
    const html = "<head><meta content='https://x.com/b.jpg' property='og:image' /></head>";
    expect(extractOgImageFromHtml(html)).toBe('https://x.com/b.jpg');
  });

  test('prefers og:image over twitter:image, whatever the order', () => {
    const html = '<head><meta name="twitter:image" content="https://x.com/tw.jpg"><meta property="og:image" content="https://x.com/og.jpg"></head>';
    expect(extractOgImageFromHtml(html)).toBe('https://x.com/og.jpg');
  });

  test('falls back to twitter:image', () => {
    const html = '<head><meta name="twitter:image" content="https://x.com/tw.jpg"></head>';
    expect(extractOgImageFromHtml(html)).toBe('https://x.com/tw.jpg');
  });

  test('decodes &amp; in the URL', () => {
    const html = '<head><meta property="og:image" content="https://x.com/i?w=1&amp;h=2"></head>';
    expect(extractOgImageFromHtml(html)).toBe('https://x.com/i?w=1&h=2');
  });

  test('ignores meta tags in the body and returns null when there is none', () => {
    const html = '<head><title>t</title></head><body><meta property="og:image" content="https://x.com/body.jpg"></body>';
    expect(extractOgImageFromHtml(html)).toBeNull();
    expect(extractOgImageFromHtml('')).toBeNull();
    expect(extractOgImageFromHtml(null)).toBeNull();
  });

  test('scans a multi-megabyte page in milliseconds', () => {
    const html = `<head><meta property="og:image" content="https://x.com/a.jpg"></head><body>${'<p>word</p>'.repeat(300_000)}</body>`;
    const startedAt = performance.now();
    expect(extractOgImageFromHtml(html)).toBe('https://x.com/a.jpg');
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
