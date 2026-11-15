/**
 * GithubExtractor summary — commits are mostly made by AI coding agents, so the
 * summary reports what moved per project and never prints commit times (which
 * the morning debrief used to read as "you coded until midnight").
 */

import { GithubExtractor, isAgentCommit } from "../../../../__capabilities/lifelog/server/adapters/extractors/GithubExtractor.mjs";

describe('GithubExtractor.summarize', () => {
  const extractor = new GithubExtractor();
  const data = [
    { type: 'commit', repo: 'me/DaylightStation', date: '2026-11-13', createdAt: '2026-11-14T07:03:00Z', message: 'feat(piano): chord staff', fullMessage: 'feat(piano): chord staff\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>' },
    { type: 'commit', repo: 'me/DaylightStation', date: '2026-11-13', createdAt: '2026-11-13T20:56:00Z', message: 'fix(school): panel', fullMessage: 'fix(school): panel' },
    { type: 'commit', repo: 'me/BookofMormonOnline', date: '2026-11-13', createdAt: '2026-11-14T05:34:00Z', message: 'fix(ops): rollback', fullMessage: 'fix(ops): rollback\n\nCo-authored-by: Codex <codex@openai.com>' },
  ];

  it('counts agent commits and groups messages by repo', () => {
    const text = extractor.summarize(extractor.extractForDate(data, '2026-11-13'));
    expect(text).toContain('3 commits, 2 made by AI coding agents');
    expect(text).toContain('DaylightStation (2):');
    expect(text).toContain('- fix(ops): rollback');
  });

  it('prints no clock times', () => {
    const text = extractor.summarize(extractor.extractForDate(data, '2026-11-13'));
    expect(text).not.toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
  });

  it('detects agent co-authorship', () => {
    expect(isAgentCommit(data[0])).toBe(true);
    expect(isAgentCommit(data[1])).toBe(false);
    expect(isAgentCommit(data[2])).toBe(true);
  });
});
