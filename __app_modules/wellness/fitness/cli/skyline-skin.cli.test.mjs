import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import { install, zoneSoundSet } from './skyline-skin.cli.mjs';

// A zone's own sound set lives at media/fitness/skyline-glider/_sounds/<zone>/.
// Rebuilding or reinstalling a zone must keep pointing at it (2026-11-11: the
// smw-* zones' sounds: blocks were hand-pointed there and a rebuild reset them).
async function scratch({ soundFiles = [], zone }) {
  const media = await mkdtemp(path.join(os.tmpdir(), 'skyline-skin-'));
  const sounds = path.join(media, 'fitness', 'skyline-glider', '_sounds', 'smw-test');
  if (soundFiles.length) {
    await mkdir(sounds, { recursive: true });
    for (const file of soundFiles) await writeFile(path.join(sounds, file), 'x');
  }
  const built = path.join(media, 'fitness', 'skyline-glider', 'smw-test');
  await mkdir(built, { recursive: true });
  await writeFile(path.join(built, 'zone.yml'), `# generated\n${YAML.stringify(zone)}`);
  return { media, zonesDir: path.join(media, 'zones') };
}

const builtZone = {
  schema: 'skyline-glider-zone/v1', id: 'smw-test', asset_root: 'fitness/skyline-glider/smw-test',
  skin: { id: 'smw-test', distribution: 'shippable' },
  sounds: { bell: '/fitness/skyline-glider/alpine/sounds/bell.mp3', crash: '/fitness/skyline-glider/alpine/sounds/crash.mp3', music: '/fitness/skyline-glider/alpine/sounds/music.mp3' },
};

describe('zoneSoundSet', () => {
  it('maps every known slot file in _sounds/<zone>/ to a media-rooted path, in slot order', async () => {
    const { media } = await scratch({ soundFiles: ['music.ogg', 'bell.mp3', 'wind.ogg', 'target.mp3', 'notes.txt', 'unknown.mp3'], zone: builtZone });
    expect(await zoneSoundSet(media, 'smw-test')).toEqual({
      bell: '/fitness/skyline-glider/_sounds/smw-test/bell.mp3',
      target: '/fitness/skyline-glider/_sounds/smw-test/target.mp3',
      wind: '/fitness/skyline-glider/_sounds/smw-test/wind.ogg',
      music: '/fitness/skyline-glider/_sounds/smw-test/music.ogg',
    });
  });

  it('is null when the zone has no sound set', async () => {
    const { media } = await scratch({ zone: builtZone });
    expect(await zoneSoundSet(media, 'smw-test')).toBeNull();
  });
});

describe('install', () => {
  it('points the installed zone at its own sound set, keeping base sounds for missing slots', async () => {
    const { media, zonesDir } = await scratch({ soundFiles: ['bell.mp3', 'music.ogg'], zone: builtZone });
    const result = await install({ zoneId: 'smw-test', zonesDir, media });
    expect(result.ok).toBe(true);
    const text = await readFile(path.join(zonesDir, 'smw-test.yml'), 'utf8');
    expect(text.startsWith('# generated\n')).toBe(true);
    expect(YAML.parse(text).sounds).toEqual({
      bell: '/fitness/skyline-glider/_sounds/smw-test/bell.mp3',
      music: '/fitness/skyline-glider/_sounds/smw-test/music.ogg',
      crash: '/fitness/skyline-glider/alpine/sounds/crash.mp3',
    });
  });

  it('installs the built zone unchanged when there is no sound set', async () => {
    const { media, zonesDir } = await scratch({ zone: builtZone });
    await install({ zoneId: 'smw-test', zonesDir, media });
    expect(YAML.parse(await readFile(path.join(zonesDir, 'smw-test.yml'), 'utf8')).sounds).toEqual(builtZone.sounds);
  });
});
