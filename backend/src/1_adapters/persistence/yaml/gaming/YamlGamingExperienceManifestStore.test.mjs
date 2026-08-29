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
    fs.writeFileSync(path.join(dir, 'dice.yml'), 'schema_version: 2\nid: dice\nversion: 1\ntheme: { id: table }\nsurfaces:\n  - id: party-games\n    presenter: dice-table\n    authority_modes: [remote]\n    inputs: [keyboard, remote]\nresult_schema: gaming-result/v1\n');
    const store = new YamlGamingExperienceManifestStore({ manifestsDir: dir });
    expect(store.list()).toEqual([{ schema_version: 2, id: 'dice', version: 1, theme: { id: 'table' }, surfaces: [{ id: 'party-games', presenter: 'dice-table', authority_modes: ['remote'], inputs: ['keyboard', 'remote'] }], result_schema: 'gaming-result/v1', hash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
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
    fs.writeFileSync(path.join(dir, 'bad.yml'), 'schema_version: 2\nid: dice\nversion: 1\nsurfaces: [{ id: party-games, presenter: dice-table, authority_modes: [remote], inputs: [remote] }]\nresult_schema: gaming-result/v1\nsetup: { kind: maybe }\n');
    expect(() => new YamlGamingExperienceManifestStore({ manifestsDir: dir }).list()).toThrow('setup kind is invalid');
    fs.writeFileSync(path.join(dir, 'bad.yml'), 'schema_version: 2\nid: dice\nversion: 1\nsurfaces: [{ id: party-games, presenter: dice-table, authority_modes: [remote], inputs: [remote], renderer_embeddings: [{ id: Bad, optional: yes }] }]\nresult_schema: gaming-result/v1\n');
    expect(() => new YamlGamingExperienceManifestStore({ manifestsDir: dir }).list()).toThrow('renderer embeddings are invalid');
  });
});
