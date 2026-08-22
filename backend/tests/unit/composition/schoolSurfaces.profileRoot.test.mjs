/**
 * Regression: surface profiles are household RENDER POLICY, not curriculum.
 *
 * Until 2026-08-21 `createSchoolSurfaces` read them from
 * `<contentRoot>/surfaces`, and `contentRoot` falls back to
 * `<dataDir>/content/school/learning-catalog` — a directory that does not
 * exist — so the Portal logged `school.surfaces.profile.unresolved` for
 * 'screen-browser' 29 times in 24h. This pins the profile root to
 * `<dataDir>/household/school/surfaces`, independent of `contentRoot`.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createSchoolSurfaces } from '#composition/modules/schoolSurfaces.mjs';

let dataDir;
beforeEach(async () => { dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'surf-')); });
afterEach(async () => { await fs.rm(dataDir, { recursive: true, force: true }); });

const schoolCatalog = () => ({
  wired: true,
  catalogs: {},
  content: {},
  lessonBundles: {},
  moduleRegistry: { list: () => [] },
  // Deliberately a path that does NOT exist — the production condition.
  diagnostics: { contentRoot: path.join(dataDir, 'content/school/learning-catalog') },
});

it('loads surface profiles from household/school/surfaces, not contentRoot', async () => {
  const dir = path.join(dataDir, 'household', 'school', 'surfaces');
  await fs.mkdir(dir, { recursive: true });
  await fs.copyFile(
    path.resolve('backend/tests/_fixtures/school/screen-browser.yml'),
    path.join(dir, 'screen-browser.yml'),
  );
  const surfaces = await createSchoolSurfaces({ schoolCatalog: schoolCatalog(), dataDir });
  expect(surfaces.registry.get('screen-browser')).toBeTruthy();
});
