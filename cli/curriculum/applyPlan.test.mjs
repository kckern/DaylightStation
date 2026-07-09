import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { planToApplyOps, applyOps } from './applyPlan.mjs';
import { buildNormalizationPlan } from './normalizePlan.mjs';

const rec = (o) => ({ file: `${o.dir}/${o.name}.nfo`, styles: [], wistia: o.wistia, oldSeason: o.oldSeason, oldEpisode: o.oldEpisode, course: o.course, title: o.title });

describe('planToApplyOps', () => {
  it('produces one op per record with rendered nfo + from/to paths', () => {
    const records = [
      { ...rec({ dir: 'Season 06 - Comping', name: 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo', wistia: 'w1', oldSeason: 6, oldEpisode: 1, course: 'Jazzy Blues Comping', title: 'Jazzy Blues Comping – Demo' }),
        _full: { showtitle: 'Piano With Jonny', plot: 'p', genres: ['Music','Educational','Blues'], skill: 'Intermediate', focus: ['Rhythm'], type: 'Course', credits: 'X', studio: 'X', wistia: 'w1', wistiaDefault: true } },
    ];
    const plan = buildNormalizationPlan(records);
    const ops = planToApplyOps(plan, records);
    expect(ops).toHaveLength(1);
    expect(ops[0].to.dir).toBe('Season 06 - Comping & Rhythm');
    expect(ops[0].nfo).toContain('<tag>Lane: lessons</tag>');
    expect(ops[0].nfo).toContain('<tag>Group: Comping</tag>');
    expect(ops[0].nfo).toContain('<season>6</season>');
  });
});

describe('applyOps (temp dir round-trip)', () => {
  it('moves the pair into the new folder and writes the new nfo', () => {
    const root = mkdtempSync(join(tmpdir(), 'reorg-'));
    mkdirSync(join(root, 'Season 06 - Comping'));
    writeFileSync(join(root, 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.mp4'), 'VIDEO');
    writeFileSync(join(root, 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.nfo'), '<x/>');
    const ops = [{ wistia: 'w1',
      from: { dir: 'Season 06 - Comping', base: 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo' },
      to: { dir: 'Season 06 - Comping & Rhythm', base: 'Piano With Jonny - S06E01 - Demo' },
      nfo: '<episodedetails><season>6</season></episodedetails>\n' }];
    const undo = applyOps(root, ops);
    expect(existsSync(join(root, 'Season 06 - Comping & Rhythm', 'Piano With Jonny - S06E01 - Demo.mp4'))).toBe(true);
    expect(readFileSync(join(root, 'Season 06 - Comping & Rhythm', 'Piano With Jonny - S06E01 - Demo.nfo'), 'utf8')).toContain('<season>6</season>');
    expect(existsSync(join(root, 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.mp4'))).toBe(false);
    expect(undo).toContain('mv');  // undo script references a reverse move

    expect(existsSync(join(root, '_undo_nfo', 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.nfo'))).toBe(true);
    expect(readFileSync(join(root, '_undo_nfo', 'Season 06 - Comping', 'Piano With Jonny - S06E01 - Jazzy Blues Comping – Demo.nfo'), 'utf8')).toBe('<x/>');
    expect(undo).toContain('rm -f');
  });
});
