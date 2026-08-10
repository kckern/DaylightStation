import { describe, it, expect } from 'vitest';
import { injectMetadata } from './enrich.mjs';

const XML = `<?xml version="1.0"?>
<score-partwise version="3.0">
  <part-list><score-part id="P1"/></part-list>
  <part id="P1"><measure number="1"/></part>
</score-partwise>`;

const PROV = {
  title: 'La Candeur',
  composer: 'Burgmüller',
  composerFull: 'Johann Friedrich Franz Burgmüller (1806-1874)',
  license: 'Public Domain',
  maintainer: 'Bas Wassink',
  sourceUrl: 'https://www.mutopiaproject.org/ftp/x.ly',
  sourcePath: 'BurgmullerJFF/O100/25EF-01',
};

describe('injectMetadata', () => {
  it('adds work-title and composer for ScorePlayer to display', () => {
    const out = injectMetadata(XML, PROV);
    expect(out).toContain('<work-title>La Candeur</work-title>');
    expect(out).toContain('<creator type="composer">Johann Friedrich Franz Burgmüller (1806-1874)</creator>');
  });

  it('records provenance and licence for later auditing', () => {
    const out = injectMetadata(XML, PROV, { converterVersion: 'ly2xml/0.1.0' });
    expect(out).toContain('name="mutopia-source-url">https://www.mutopiaproject.org/ftp/x.ly<');
    expect(out).toContain('name="license">Public Domain<');
    expect(out).toContain('name="converter">ly2xml/0.1.0<');
  });

  it('qualifies the title with the movement when there is one', () => {
    const out = injectMetadata(XML, { ...PROV, title: 'Sonatina' }, { movement: 'I. Spiritoso' });
    expect(out).toContain('<work-title>Sonatina (I. Spiritoso)</work-title>');
  });

  it('escapes XML-significant characters', () => {
    const out = injectMetadata(XML, { ...PROV, title: 'Fun & <Games>' });
    expect(out).toContain('<work-title>Fun &amp; &lt;Games&gt;</work-title>');
    expect(out).not.toContain('<Games>');
  });

  it('is idempotent — re-running replaces rather than duplicates', () => {
    const once = injectMetadata(XML, PROV);
    const twice = injectMetadata(once, PROV);
    expect((twice.match(/<work-title>/g) || []).length).toBe(1);
    expect((twice.match(/<identification>/g) || []).length).toBe(1);
  });

  it('omits provenance fields that are absent rather than emitting empties', () => {
    const out = injectMetadata(XML, { title: 'X', composer: 'Y' });
    expect(out).not.toContain('name="typesetter"');
    expect(out).not.toContain('name="mutopia-source-url"');
  });

  it('leaves a non-MusicXML payload untouched', () => {
    expect(injectMetadata('not xml', PROV)).toBe('not xml');
  });
});
