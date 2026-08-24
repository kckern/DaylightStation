import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlGamingExperienceManifestStore } from './YamlGamingExperienceManifestStore.mjs';

const dirs = [];
function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-manifests-')); dirs.push(dir); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('YamlGamingExperienceManifestStore', () => {
  it('loads only mounted manifests and validates their independent contract', () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'dice.yml'), 'id: dice\nversion: 1\nnative_surface_id: group-play\ntheme: { id: table }\npresenters: { primary: dice-table }\n');
    const store = new YamlGamingExperienceManifestStore({ manifestsDir: dir });
    expect(store.list()).toEqual([{ id: 'dice', version: 1, native_surface_id: 'group-play', theme: { id: 'table' }, presenters: { primary: 'dice-table' }, hash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(store.get('dice')).toMatchObject({ version: 1 });
    expect(store.get('../dice')).toBeNull();
  });

  it('fails closed on malformed mounted artifacts', () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'bad.yml'), 'id: Bad Name\nversion: 0\n');
    expect(() => new YamlGamingExperienceManifestStore({ manifestsDir: dir }).list()).toThrow('manifest id is invalid');
  });

  it('fails closed on malformed setup and optional renderer contracts', () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'bad.yml'), 'id: dice\nversion: 1\nnative_surface_id: group-play\npresenters: { primary: dice-table }\nsetup: { kind: maybe }\n');
    expect(() => new YamlGamingExperienceManifestStore({ manifestsDir: dir }).list()).toThrow('setup kind is invalid');
    fs.writeFileSync(path.join(dir, 'bad.yml'), 'id: dice\nversion: 1\nnative_surface_id: group-play\npresenters: { primary: dice-table }\nrenderer_embeddings: [{ id: Bad, optional: yes }]\n');
    expect(() => new YamlGamingExperienceManifestStore({ manifestsDir: dir }).list()).toThrow('renderer embeddings are invalid');
  });
});
