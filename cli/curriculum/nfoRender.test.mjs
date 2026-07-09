import { describe, it, expect } from 'vitest';
import { parseNfoFull, renderNfo } from './nfoRender.mjs';

const ORIG = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title>Silent Night – Rhumba 1 – Rhumba Groove Exercise</title>
  <showtitle>Piano With Jonny</showtitle>
  <season>10</season>
  <episode>607</episode>
  <plot>Groove. From "Silent Night – Rhumba 1" by Piano With Jonny.</plot>
  <genre>Music</genre>
  <genre>Educational</genre>
  <tag>Course: Silent Night – Rhumba 1</tag>
  <genre>Latin</genre>
  <tag>Skill Level: Intermediate</tag>
  <tag>Focus: Songs</tag>
  <tag>Type: Course</tag>
  <credits>John Proulx</credits>
  <studio>John Proulx</studio>
  <uniqueid type="wistia" default="true">po6f0g0bmc</uniqueid>
</episodedetails>`;

describe('parseNfoFull', () => {
  it('captures preserved fields incl. wistia', () => {
    const f = parseNfoFull(ORIG);
    expect(f).toMatchObject({
      showtitle: 'Piano With Jonny',
      genres: ['Music', 'Educational', 'Latin'],
      skill: 'Intermediate',
      focus: ['Songs'],
      type: 'Course',
      credits: 'John Proulx',
      studio: 'John Proulx',
      wistia: 'po6f0g0bmc',
      wistiaDefault: true,
    });
    expect(f.plot).toContain('Groove.');
  });
  it('decodes &amp; last so &amp;lt; survives as &lt;', () => {
    const xml = `<episodedetails><plot>Use &amp;lt; here</plot><season>1</season><episode>1</episode></episodedetails>`;
    expect(parseNfoFull(xml).plot).toBe('Use &lt; here');
  });
});

describe('renderNfo', () => {
  it('renders new season/episode/title + injected tags, preserving the rest', () => {
    const out = renderNfo({
      title: 'Rhumba Groove Exercise', showtitle: 'Piano With Jonny',
      season: 8, episode: 42, plot: 'Groove.', genres: ['Music', 'Educational', 'Latin'],
      course: 'Silent Night – Rhumba', part: 1, lane: 'repertoire', group: null,
      song: 'Silent Night', treatment: 'tutorial', skillChallenge: false,
      skill: 'Intermediate', focus: ['Songs'], type: 'Course',
      credits: 'John Proulx', studio: 'John Proulx', wistia: 'po6f0g0bmc', wistiaDefault: true,
    });
    expect(out).toContain('<season>8</season>');
    expect(out).toContain('<episode>42</episode>');
    expect(out).toContain('<title>Rhumba Groove Exercise</title>');
    expect(out).toContain('<tag>Course: Silent Night – Rhumba</tag>');
    expect(out).toContain('<tag>Part: 1</tag>');
    expect(out).toContain('<tag>Lane: repertoire</tag>');
    expect(out).toContain('<tag>Song: Silent Night</tag>');
    expect(out).toContain('<tag>Treatment: tutorial</tag>');
    expect(out).toContain('<uniqueid type="wistia" default="true">po6f0g0bmc</uniqueid>');
    expect(out).not.toContain('<tag>Group:');          // group null → omitted
    expect(out).not.toContain('SkillChallenge');        // false → omitted
    expect(out).not.toContain('<tag>Part: 1</tag>\n  <tag>Part:'); // single part tag
  });
  it('escapes entities and round-trips preserved fields', () => {
    const f = parseNfoFull(ORIG);
    const out = renderNfo({ title: 'A & B', showtitle: f.showtitle, season: 1, episode: 1,
      plot: f.plot, genres: f.genres, course: 'X', part: null, lane: 'lessons', group: 'G',
      song: null, treatment: null, skillChallenge: false, skill: f.skill, focus: f.focus,
      type: f.type, credits: f.credits, studio: f.studio, wistia: f.wistia, wistiaDefault: f.wistiaDefault });
    expect(out).toContain('<title>A &amp; B</title>');
    expect(parseNfoFull(out)).toMatchObject({ genres: ['Music', 'Educational', 'Latin'], wistia: 'po6f0g0bmc' });
  });
  it('throws on missing title or non-finite season/episode', () => {
    expect(() => renderNfo({ title: '', season: 1, episode: 1 })).toThrow(/title/);
    expect(() => renderNfo({ title: 'X', season: NaN, episode: 1, genres: [], focus: [] })).toThrow(/season/);
  });
});
