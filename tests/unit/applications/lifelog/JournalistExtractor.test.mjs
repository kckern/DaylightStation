/**
 * JournalistExtractor — date matching across both stored timestamp shapes.
 *
 * messages.yml held local "YYYY-MM-DD HH:mm:ss" strings until early 2026, then
 * switched to ISO UTC ("2026-11-07T19:55:44.036Z"). The extractor only knew the
 * first shape, so every entry after the switch fell out of the daily debrief.
 */

import { execFileSync } from 'node:child_process';

describe('JournalistExtractor', () => {
  const data = {
    messages: [
      // 2026-11-01T04:38Z is the evening of Oct 31 in Pacific time
      { id: 'a', senderId: '1', senderName: 'KC', timestamp: '2026-11-01T04:38:51.881Z', content: 'Alright, I just finished another run, feeling okay.' },
      { id: 'b', senderId: 'bot', senderName: 'Journalist', timestamp: '2026-11-01T04:38:54.592Z', content: 'What are you hoping your day-to-day would look like?' },
      { id: 'c', senderId: '1', senderName: 'KC', timestamp: '2026-11-07T19:55:44.036Z', content: 'Best pace of any 10k I have done so far.' },
      // legacy local-time shape
      { id: 'd', senderId: '1', senderName: 'KC', timestamp: '2025-12-30 23:42:43', content: 'Legacy entry written before the format change.' },
    ],
  };

  // TZ changes inside Vitest threads do not update the native local timezone.
  // Start a real Node process in Pacific time so this also runs on UTC hosts.
  const extract = (date) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { JournalistExtractor } from ${JSON.stringify(new URL('../../../../__capabilities/lifelog/server/adapters/extractors/JournalistExtractor.mjs', import.meta.url).href)};
    const extractor = new JournalistExtractor();
    const entry = extractor.extractForDate(${JSON.stringify(data)}, ${JSON.stringify(date)});
    process.stdout.write(JSON.stringify({ entry, summary: extractor.summarize(entry) }));
  `], { env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' }));

  it('matches ISO UTC timestamps by local date', () => {
    const { entry } = extract('2026-10-31');
    expect(entry?.messages.map((m) => m.id)).toEqual(['a']);
    expect(extract('2026-11-01').entry).toBeNull();
  });

  it('still matches the legacy local-time shape', () => {
    expect(extract('2025-12-30').entry?.messages.map((m) => m.id)).toEqual(['d']);
  });

  it('prints local HH:mm in the summary for both shapes', () => {
    expect(extract('2026-10-31').summary).toContain('[21:38] Alright');
    expect(extract('2025-12-30').summary).toContain('[23:42] Legacy');
  });
});
