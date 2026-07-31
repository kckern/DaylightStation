import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { YamlCurriculumDatastore } from '#adapters/persistence/yaml/YamlCurriculumDatastore.mjs';
import { ICurriculumCatalog } from '#apps/school/ports/ICurriculumCatalog.mjs';

let tmp, ds;

// The catalog is filed <subject>/<work>/<kind>/, so a fixture needs a real shelf
// and a work folder beneath it. `math/testwork` stands in for both throughout.
const SUBJECT = 'math';
const WORK = 'testwork';
const workDir = (...rest) => path.join(tmp, 'content', 'school', SUBJECT, WORK, ...rest);
const curriculumDir = workDir;

function write(kind, file, text) {
  const dir = workDir(kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-curriculum-'));
  ds = new YamlCurriculumDatastore({ configService: { getDataDir: () => tmp } });
});

describe('construction', () => {
  it('implements the port', () => {
    expect(ds).toBeInstanceOf(ICurriculumCatalog);
  });
  it('refuses to construct without a configService', () => {
    expect(() => new YamlCurriculumDatastore({})).toThrow(/configService/);
  });
  it('the port itself is abstract — every method throws until implemented', async () => {
    const bare = new ICurriculumCatalog();
    for (const m of ['listUnits', 'listDocuments', 'listManifests', 'listWorks']) {
      await expect(bare[m]()).rejects.toThrow(/must be implemented/);
    }
    for (const m of ['getUnit', 'getDocument', 'getManifest', 'getWork']) {
      await expect(bare[m]('x')).rejects.toThrow(/must be implemented/);
    }
  });
});

describe('listing', () => {
  it('missing directories list nothing instead of throwing', async () => {
    await expect(ds.listUnits()).resolves.toEqual({ items: [], errors: [] });
    await expect(ds.listDocuments()).resolves.toEqual({ items: [], errors: [] });
    await expect(ds.listManifests()).resolves.toEqual({ items: [], errors: [] });
    await expect(ds.listWorks()).resolves.toEqual({ items: [], errors: [] });
  });

  it('a directory that is not a directory is reported, not read as empty', async () => {
    fs.mkdirSync(workDir(), { recursive: true });
    fs.writeFileSync(workDir('units'), 'oops, a file\n');
    const { items, errors } = await ds.listUnits();
    expect(items).toEqual([]);
    expect(errors).toEqual([expect.stringMatching(/^math\/testwork\/units: unreadable directory/)]);
  });

  it('returns raw parsed YAML keyed by basename, sorted, with no validation applied', async () => {
    // Deliberately NOT a valid unit — the adapter must hand back whatever parsed.
    write('units', 'math-3.4.yml', 'unitId: math-3.4\nnonsense: true\n');
    write('units', 'alpha.yaml', 'unitId: alpha\n');
    const { items, errors } = await ds.listUnits();
    expect(errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(['alpha', 'math-3.4']);
    expect(items[1].raw).toEqual({ unitId: 'math-3.4', nonsense: true });
  });

  it('lists documents and manifests from their own directories', async () => {
    write('documents', 'ws-01.yml', 'id: ws-01\n');
    write('manifests', 'nova-01.yml', 'id: nova-01\n');
    expect((await ds.listDocuments()).items).toEqual([{ id: 'ws-01', raw: { id: 'ws-01' } }]);
    expect((await ds.listManifests()).items).toEqual([{ id: 'nova-01', raw: { id: 'nova-01' } }]);
    expect((await ds.listUnits()).items).toEqual([]);
  });

  it('reads every file when there are more than one batch', async () => {
    for (let i = 0; i < 25; i++) write('units', `u-${String(i).padStart(2, '0')}.yml`, `unitId: u-${i}\n`);
    const { items, errors } = await ds.listUnits({ batch: 4 });
    expect(errors).toEqual([]);
    expect(items).toHaveLength(25);
    expect(items.every((i) => i.raw)).toBe(true);
  });

  it('skips AppleDouble and hidden sidecars', async () => {
    write('units', 'real.yml', 'unitId: real\n');
    write('units', '._real.yml', 'garbage: [unclosed\n');
    write('units', '.hidden.yml', 'unitId: hidden\n');
    const { items, errors } = await ds.listUnits();
    expect(items.map((i) => i.id)).toEqual(['real']);
    expect(errors).toEqual([]);
  });

  it('ignores subdirectories — curriculum ids are flat basenames', async () => {
    fs.mkdirSync(workDir('units', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(workDir('units', 'nested'), 'deep.yml'), 'unitId: deep\n');
    write('units', 'flat.yml', 'unitId: flat\n');
    expect((await ds.listUnits()).items.map((i) => i.id)).toEqual(['flat']);
  });
});

describe('malformed files isolate to themselves', () => {
  it('one unparseable file is reported in errors and its siblings still load', async () => {
    write('units', 'good-a.yml', 'unitId: good-a\n');
    write('units', 'broken.yml', 'unitId: broken\n  bad indentation: [\n');
    write('units', 'good-b.yml', 'unitId: good-b\n');

    const { items, errors } = await ds.listUnits();
    expect(items.map((i) => i.id)).toEqual(['good-a', 'good-b']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^units\/broken: /);
  });

  it('a file whose name is not a safe id is reported, not silently dropped', async () => {
    write('units', 'ok.yml', 'unitId: ok\n');
    write('units', '-leading-dash.yml', 'unitId: x\n');
    const { items, errors } = await ds.listUnits();
    expect(items.map((i) => i.id)).toEqual(['ok']);
    // Path-qualified, unlike the parse error above: an id this malformed cannot
    // be found BY id, so the error names where the file actually sits.
    expect(errors).toEqual([expect.stringMatching(/^math\/testwork\/units\/-leading-dash: .*unsafe/i)]);
  });

  it('an empty file parses to null and is reported rather than yielding a null entry', async () => {
    write('documents', 'empty.yml', '');
    write('documents', 'ok.yml', 'id: ok\n');
    const { items, errors } = await ds.listDocuments();
    expect(items.map((i) => i.id)).toEqual(['ok']);
    expect(errors).toEqual([expect.stringMatching(/^documents\/empty: /)]);
  });
});

describe('single reads', () => {
  it('reads one entity by id from each directory', async () => {
    write('units', 'u1.yml', 'unitId: u1\n');
    write('documents', 'd1.yaml', 'id: d1\n');
    write('manifests', 'm1.yml', 'id: m1\n');
    await expect(ds.getUnit('u1')).resolves.toEqual({ unitId: 'u1' });
    await expect(ds.getDocument('d1')).resolves.toEqual({ id: 'd1' });
    await expect(ds.getManifest('m1')).resolves.toEqual({ id: 'm1' });
  });

  it('unknown or unparseable ids read null', async () => {
    write('units', 'broken.yml', 'unitId: broken\n  bad: [\n');
    await expect(ds.getUnit('nope')).resolves.toBe(null);
    await expect(ds.getUnit('broken')).resolves.toBe(null);
  });

  it('a traversal-attempting id cannot climb out of its directory', async () => {
    fs.mkdirSync(workDir('documents'), { recursive: true });
    fs.writeFileSync(workDir('secrets.yml'), 'id: secrets\n');
    write('units', 'secrets.yml', 'unitId: unit-secrets\n');

    // Same-named sibling one level up, and a cross-kind hop, must both fail.
    await expect(ds.getDocument('../secrets')).resolves.toBe(null);
    await expect(ds.getDocument('../units/secrets')).resolves.toBe(null);
    await expect(ds.getUnit('/etc/passwd')).resolves.toBe(null);
    await expect(ds.getUnit('..')).resolves.toBe(null);
    await expect(ds.getUnit('./secrets')).resolves.toBe(null);
  });

  it('non-string ids return null instead of throwing', async () => {
    await expect(ds.getUnit(null)).resolves.toBe(null);
    await expect(ds.getUnit(['a', 'b'])).resolves.toBe(null);
    await expect(ds.getUnit(undefined)).resolves.toBe(null);
  });
});

describe('work configs', () => {
  const writeWork = (subject, work, text) => {
    const dir = path.join(tmp, 'content', 'school', subject, work);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'work.yml'), text);
  };

  it('lists one work per work.yml, keyed by <subject>/<work>', async () => {
    writeWork('math', 'fractions', 'work: fractions\n');
    writeWork('history', 'capitals', 'work: capitals\n');
    const { items, errors } = await ds.listWorks();
    expect(errors).toEqual([]);
    expect(items.map((i) => i.id)).toEqual(['math/fractions', 'history/capitals']);
    // subject and work travel with the entry so a validator can check placement
    expect(items[0]).toMatchObject({ subject: 'math', work: 'fractions' });
  });

  it('a work folder with no work.yml is not an error — most have none yet', async () => {
    write('units', 'u1.yml', 'unitId: u1\n');
    await expect(ds.listWorks()).resolves.toEqual({ items: [], errors: [] });
  });

  it('an unparseable or empty work.yml is reported and isolates to itself', async () => {
    writeWork('math', 'good', 'work: good\n');
    writeWork('math', 'broken', 'work: broken\n  bad: [\n');
    writeWork('math', 'blank', '');
    const { items, errors } = await ds.listWorks();
    expect(items.map((i) => i.id)).toEqual(['math/good']);
    expect(errors).toHaveLength(2);
    expect(errors.join(' ')).toMatch(/math\/blank: work\.yml is empty/);
  });

  it('reads one work by id, and refuses anything that is not <subject>/<work>', async () => {
    writeWork('math', 'fractions', 'work: fractions\ntitle: Fractions\n');
    await expect(ds.getWork('math/fractions')).resolves.toEqual({ work: 'fractions', title: 'Fractions' });
    for (const bad of ['fractions', 'math', 'math/fractions/extra', 'nope/fractions',
                       'math/../../etc/passwd', '../../etc/passwd', null, 42]) {
      await expect(ds.getWork(bad)).resolves.toBe(null);
    }
  });
});
