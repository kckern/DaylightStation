import { describe, it, expect } from 'vitest';
import { firstMatchingLink, firstYouTubeEmbedId, publishedDate } from './curatedPage.mjs';

const PATTERN = '/newshour/classroom/daily-news-lessons/\\d{4}/\\d{2}/[a-z0-9-]+';

describe('curatedPage', () => {
  const listing = `<a href="/about">x</a>
    <a href="/newshour/classroom/daily-news-lessons/2026/10/whats-next-for-israel">a</a>
    <a href="/newshour/classroom/daily-news-lessons/2026/10/older-one">b</a>`;

  it('returns the first link matching the pattern, absolutized', () => {
    expect(firstMatchingLink(listing, PATTERN, 'https://www.pbs.org/newshour/classroom/daily-news-lessons'))
      .toBe('https://www.pbs.org/newshour/classroom/daily-news-lessons/2026/10/whats-next-for-israel');
  });

  it('matches absolute links and stops at a query string', () => {
    const html = '<a href="https://www.pbs.org/newshour/classroom/daily-news-lessons/2026/10/a-b?utm=x">';
    expect(firstMatchingLink(html, PATTERN, 'https://www.pbs.org/'))
      .toBe('https://www.pbs.org/newshour/classroom/daily-news-lessons/2026/10/a-b');
  });

  it('returns null when nothing matches', () => {
    expect(firstMatchingLink('<a href="/a">', 'zzz', 'https://e.com')).toBeNull();
  });

  it('reads an embedded YouTube id in embed, nocookie, watch and short forms', () => {
    expect(firstYouTubeEmbedId('<iframe src="https://www.youtube.com/embed/QAyxgojwmec?rel=0">')).toBe('QAyxgojwmec');
    expect(firstYouTubeEmbedId('<iframe src="https://www.youtube-nocookie.com/embed/QAyxgojwmec">')).toBe('QAyxgojwmec');
    expect(firstYouTubeEmbedId('<a href="https://www.youtube.com/watch?v=QAyxgojwmec">')).toBe('QAyxgojwmec');
    expect(firstYouTubeEmbedId('<a href="https://youtu.be/QAyxgojwmec">')).toBe('QAyxgojwmec');
    expect(firstYouTubeEmbedId('<p>none</p>')).toBeNull();
  });

  it('reads the page publish date as YYYYMMDD (schema.org or article meta)', () => {
    expect(publishedDate('<script>{"datePublished":"2026-10-29T14:03:00+00:00"}</script>')).toBe('20261029');
    expect(publishedDate('<meta property="article:published_time" content="2026-10-28T23:10:00Z">')).toBe('20261028');
    expect(publishedDate('<p>undated</p>')).toBeNull();
  });
});
