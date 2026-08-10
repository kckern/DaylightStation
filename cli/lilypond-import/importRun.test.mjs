import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { convertSource, runImport } from './importRun.mjs';

const SRC = `\\version "2.18.2"
\\header { title = "La Candeur" mutopiacomposer = "BurgmullerJFF" opus = "Opus 100." }
Global = {\\key c\\major \\time 4/4}
vOne = \\relative c''' { g8-5 e-3 d c }
vThree = \\relative c { c4 e g e }
\\score { \\context PianoStaff <<
  \\context Staff = "up" << \\Global \\clef treble \\vOne >>
  \\context Staff = "down" << \\Global \\clef bass \\vThree >>
>> \\layout {} }`;

const goodXml = `<?xml version="1.0"?>
<score-partwise version="3.0"><part-list><score-part id="P1"/></part-list>
<part id="P1"><measure number="1"><attributes><staves>2</staves></attributes>
<note><notations><technical><fingering>5</fingering></technical></notations></note>
</measure></part></score-partwise>`;

// python-ly's real silent-failure mode: valid doc, empty part, exit 0.
const emptyXml = `<?xml version="1.0"?>
<score-partwise version="3.0"><part-list><score-part id="P1"/></part-list>
<part id="P1"></part></score-partwise>`;

const fakeConvert = (xml, backendError = null) => async () => ({ xml, stderr: '', backendError });

describe('convertSource', () => {
  it('produces a named, enriched score when conversion validates', async () => {
    const [r] = await convertSource({
      src: SRC, sourcePath: 'BurgmullerJFF/O100/25EF-01/25EF-01.ly', convert: fakeConvert(goodXml),
    });
    expect(r.ok).toBe(true);
    expect(r.basename).toBe('Burgmüller Op. 100 No. 01 — La Candeur');
    expect(r.xml).toContain('<work-title>La Candeur</work-title>');
    expect(r.stats.fingerings).toBe(1);
  });

  it('rejects — and does NOT return xml for — a silent backend failure', async () => {
    const [r] = await convertSource({
      src: SRC, sourcePath: 'x/25EF-01/25EF-01.ly', convert: fakeConvert(emptyXml),
    });
    expect(r.ok).toBe(false);
    expect(r.xml).toBeNull();
    expect(r.reasons.join(' ')).toMatch(/no notes/);
  });

  it('surfaces a backend crash in the reasons', async () => {
    const [r] = await convertSource({
      src: SRC, sourcePath: 'x/1/x.ly', convert: fakeConvert('', 'spawn ENOENT'),
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/backend: spawn ENOENT/);
  });

  it('reports a source whose staves cannot be resolved instead of skipping it', async () => {
    const [r] = await convertSource({ src: '\\version "2.18.2"\n% no music', sourcePath: 'x/1/x.ly', convert: fakeConvert(goodXml) });
    expect(r.ok).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/no resolvable staves/);
  });

  it('emits one result per movement for a multi-score file', async () => {
    // A genuine second movement draws on its OWN variables. (Re-using the same
    // ones is the \layout+\midi twin idiom, which normalize collapses.)
    const multi = `${SRC}
mvtTwoUp = \\relative c'' { e4 f g a }
mvtTwoDown = \\relative c { c2 g }
\\score { \\context PianoStaff <<
  \\context Staff = "up" << \\Global \\clef treble \\mvtTwoUp >>
  \\context Staff = "down" << \\Global \\clef bass \\mvtTwoDown >>
>> \\layout {} }`;
    const rs = await convertSource({ src: multi, sourcePath: 'x/sonatina-1/s.ly', convert: fakeConvert(goodXml) });
    expect(rs).toHaveLength(2);
    expect(rs[0].movement).toBe('I');
    expect(rs[1].movement).toBe('II');
    expect(rs[0].basename).not.toBe(rs[1].basename);
  });

  it('collapses the \\layout + \\midi twin-score idiom to a single result', async () => {
    const twin = `${SRC}
\\score { \\context PianoStaff <<
  \\context Staff = "up" << \\Global \\clef treble \\vOne >>
  \\context Staff = "down" << \\Global \\clef bass \\vThree >>
>> \\midi { \\tempo 4 = 60 } }`;
    const rs = await convertSource({ src: twin, sourcePath: 'x/1/x.ly', convert: fakeConvert(goodXml) });
    expect(rs).toHaveLength(1);
    expect(rs[0].movement).toBeNull(); // single movement ⇒ no roman-numeral suffix
  });
});

describe('runImport', () => {
  it('writes only what passes the gate, and ledgers every outcome', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyimp-'));
    const srcFile = path.join(dir, 'in.ly');
    await fs.writeFile(srcFile, SRC, 'utf8');
    const outDir = path.join(dir, 'out');

    const good = await runImport({
      sources: [{ file: srcFile, sourcePath: 'B/O100/25EF-01/25EF-01.ly' }],
      outDir, ledgerPath: path.join(outDir, 'ledger.jsonl'), convert: fakeConvert(goodXml),
    });
    expect(good.written).toBe(1);
    expect(good.failed).toBe(0);
    const files = await fs.readdir(outDir);
    expect(files).toContain('Burgmüller Op. 100 No. 01 — La Candeur.musicxml');
    const ledger = await fs.readFile(path.join(outDir, 'ledger.jsonl'), 'utf8');
    expect(JSON.parse(ledger.trim()).ok).toBe(true);

    const bad = await runImport({
      sources: [{ file: srcFile, sourcePath: 'B/O100/25EF-02/25EF-02.ly' }],
      outDir: path.join(dir, 'out2'), ledgerPath: null, convert: fakeConvert(emptyXml),
    });
    expect(bad.written).toBe(0);
    expect(bad.failed).toBe(1);
    await expect(fs.readdir(path.join(dir, 'out2'))).rejects.toThrow(); // nothing created
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes nothing on a dry run but still reports results', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lyimp-'));
    const srcFile = path.join(dir, 'in.ly');
    await fs.writeFile(srcFile, SRC, 'utf8');
    const outDir = path.join(dir, 'out');
    const r = await runImport({
      sources: [{ file: srcFile, sourcePath: 'B/O100/25EF-01/x.ly' }],
      outDir, ledgerPath: path.join(outDir, 'l.jsonl'), dryRun: true, convert: fakeConvert(goodXml),
    });
    expect(r.written).toBe(1);
    await expect(fs.readdir(outDir)).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
