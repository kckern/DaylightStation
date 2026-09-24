// @vitest-environment node
/**
 * contentfilter CLI: `srt-mutes` and `srt-review` end to end against a
 * throwaway data tree (--srt fixture, no Plex, no Jev key). The CLI runs main()
 * at import, so it is exercised as a child process.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(repoRoot, 'cli/contentfilter.cli.mjs');

const SRT = `1
00:00:10,000 --> 00:00:12,000
What the HELL is this?

2
00:00:20,000 --> 00:00:22,000
Goddammit, you jerk.

3
00:00:30,000 --> 00:00:32,000
Hello, shell.
`;

const WORDS = {
  meta: { source: 'fixture' },
  words: {
    hell: { group: 'profanity', tier: 'strict', forms: ['hell'] },
    goddamn: { group: 'blasphemy', tier: 'moderate', forms: ['goddammit'] },
    jerk: { group: 'childish', tier: 'strict', forms: ['jerk'] },
  },
};

describe('contentfilter srt-mutes / srt-review (fixture tree)', () => {
  let root;
  let env;
  const overridePath = () => path.join(root, 'data/household/content-filter/overrides/123.yml');

  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', cwd: repoRoot });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-srt-'));
    const cf = path.join(root, 'data/household/content-filter');
    fs.mkdirSync(path.join(cf, 'overrides'), { recursive: true });
    fs.writeFileSync(path.join(cf, 'bad-words.yml'), yaml.dump(WORDS));
    const existing = { contentId: 'plex:123', addCues: [{ id: 'manual1', effect: 'skip', in: 1, out: 2, source: 'manual' }] };
    fs.writeFileSync(overridePath(), yaml.dump(existing));
    fs.mkdirSync(path.join(root, 'media/content-filter/edl'), { recursive: true });
    fs.writeFileSync(path.join(root, 'media/content-filter/edl/123.edl.yml'), yaml.dump({ cues: [] }));
    // Minimal system tree so the CLI bootstrap's ConfigService initialises (no jev.yml).
    fs.mkdirSync(path.join(root, 'data/system/config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/system/config/system.yml'), yaml.dump({
      households: { default: 'default' }, timezone: 'America/Los_Angeles', secrets: { provider: 'yaml' },
    }));
    fs.mkdirSync(path.join(root, 'data/household/config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/household/config/household.yml'), yaml.dump({
      head: 'testuser', users: ['testuser'], timezone: 'America/Los_Angeles',
    }));
    fs.mkdirSync(path.join(root, 'data/users/testuser'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/users/testuser/profile.yml'), yaml.dump({ name: 'Test User' }));
    fs.writeFileSync(path.join(root, 'movie.srt'), SRT);
    env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DAYLIGHT_BASE_PATH: root,
      DAYLIGHT_DATA_DIR: path.join(root, 'data'),
      DAYLIGHT_MEDIA_DIR: path.join(root, 'media'),
    };
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('srt-mutes --write stores one mute per listed word from bad-words.yml, keeping non-srt cues', () => {
    const res = run('srt-mutes', '123', '--srt', path.join(root, 'movie.srt'), '--write');
    expect(res.status, res.stderr).toBe(0);
    const override = yaml.load(fs.readFileSync(overridePath(), 'utf8'));
    expect(override.addCues).toEqual([
      { id: 'manual1', effect: 'skip', in: 1, out: 2, source: 'manual' },
      { id: 'srt10000_2', effect: 'mute', category: 'language/profanity/hell', channel: 'audio', severity: 'low',
        in: 10.66, out: 10.71, label: 'hell', source: 'srt', precision: 'srt-line' },
      { id: 'srt20000_0', effect: 'mute', category: 'language/blasphemy/goddamn', channel: 'audio', severity: 'medium',
        in: 20, out: 20.05, label: 'goddamn', source: 'srt', precision: 'srt-line' },
      { id: 'srt20000_2', effect: 'mute', category: 'language/childish/jerk', channel: 'audio', severity: 'low',
        in: 20.66, out: 20.71, label: 'jerk', source: 'srt', precision: 'srt-line' },
    ]);
  });

  it('srt-mutes --write warns about srt cueOverrides that no longer match an emitted cue', () => {
    const override = yaml.load(fs.readFileSync(overridePath(), 'utf8'));
    override.cueOverrides = { srt10000_2: { disabled: true }, srt99999_0: { disabled: true }, va1: { disabled: true } };
    fs.writeFileSync(overridePath(), yaml.dump(override));
    const res = run('srt-mutes', '123', '--srt', path.join(root, 'movie.srt'), '--write');
    expect(res.status, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/srt99999_0/);
    expect(res.stderr).not.toMatch(/orphan.*srt10000_2/);
    expect(res.stderr).not.toMatch(/va1/);
  });

  it('srt-review with no Jev key writes a review file of unjudged cues and never touches the override', () => {
    const before = fs.readFileSync(overridePath(), 'utf8');
    const out = path.join(root, 'review.yml');
    const res = run('srt-review', '123', '--srt', path.join(root, 'movie.srt'), '--out', out);
    expect(res.status, res.stderr).toBe(0);
    expect(fs.readFileSync(overridePath(), 'utf8')).toBe(before);
    const doc = yaml.load(fs.readFileSync(out, 'utf8'));
    expect(doc).toMatchObject({ contentId: 'plex:123', model: null, wordList: 'fixture' });
    expect(doc.summary).toMatchObject({ cues: 3, agree: 0, review: 3, unavailable: 3 });
    expect(doc.items.map((i) => [i.cueId, i.word, i.category, i.reasons, i.decision])).toEqual([
      ['srt10000_2', 'hell', 'language/profanity/hell', ['model-unavailable'], null],
      ['srt20000_0', 'goddammit', 'language/blasphemy/goddamn', ['model-unavailable'], null],
      ['srt20000_2', 'jerk', 'language/childish/jerk', ['model-unavailable'], null],
    ]);
    expect(doc.items[1]).toMatchObject({ line: 'goddammit, you jerk.', before: 'what the hell is this?', after: 'hello, shell.' });
  });
});
