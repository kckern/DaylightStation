import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scss-browser-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, source) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  };
  const source = readFileSync(new URL('../../../scripts/check-scss-build.mjs', import.meta.url), 'utf8');
  const original = "import * as sass from 'sass';";
  assert.equal(source.split(original).length, 2, 'replace precisely the installed Sass import');
  const sassPath = createRequire(import.meta.url).resolve('sass').replace(/sass\.node\.js$/, 'sass.node.mjs');
  assert.ok(existsSync(sassPath), 'installed ESM Sass entry exists');
  const sassUrl = pathToFileURL(sassPath).href;
  put('scripts/check-scss-build.mjs', source.replace(original, `import * as sass from '${sassUrl}';`));
  return { root, put, run() {
    return spawnSync(process.execPath, [join(root, 'scripts/check-scss-build.mjs')], { cwd: root, encoding: 'utf8' });
  } };
}

test('SCSS CLI preserves legacy imports and accepts absent destination roots without compiling standalone partials', (t) => {
  const f = fixture(t);
  f.put('frontend/src/Legacy.jsx', "import './Legacy.scss'; throw new Error('Source must never execute');");
  f.put('frontend/src/Legacy.scss', "@use '@/tokens'; .legacy { color: tokens.$color; }");
  f.put('frontend/src/_tokens.scss', '$color: red;');
  f.put('frontend/src/_unused.scss', '@error "Standalone partial must not compile";');
  f.put('frontend/src/vendor/LegacyVendor.js', "import './LegacyVendor.scss';");
  f.put('frontend/src/vendor/LegacyVendor.scss', '.vendor { color: purple; }');
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /2 entrypoint stylesheet\(s\) compiled/);
});

for (const root of ['__app_modules', '__app_modules/personal', '__capabilities']) {
  test(`${root}: real broken/restored browser Sass is discovered once with shared partials`, (t) => {
    const f = fixture(t);
    f.put('frontend/src/Legacy.js', "import './Legacy.scss'; throw new Error('Must not evaluate');");
    f.put('frontend/src/Legacy.scss', '.legacy { color: blue; }');
    const browser = `${root}/gratitude/browser`;
    f.put(`${root}/gratitude/_shared.scss`, '$color: green;');
    f.put(`${browser}/Gratitude.jsx`, "import './Gratitude.scss'; throw new Error('Must not evaluate');");
    f.put(`${browser}/Other.mjs`, "import './Gratitude.scss'; throw new Error('Must not evaluate');");
    f.put(`${browser}/Gratitude.scss`, '.broken { color: ;');
    f.put(`${browser}/_standalone.scss`, '@error "Do not compile partials alone";');
    for (const dir of ['server', 'browser/vendor', 'browser/node_modules', 'browser/.cache']) {
      f.put(`${root}/gratitude/${dir}/Ignored.js`, "import './Ignored.scss'; throw new Error('Must not evaluate');");
      f.put(`${root}/gratitude/${dir}/Ignored.scss`, '@error "Ignored source";');
    }
    symlinkSync(join(f.root, browser), join(f.root, browser, 'loop'));
    symlinkSync(join(f.root, root, 'gratitude/server'), join(f.root, browser, 'linked-server'));
    symlinkSync(join(f.root, root, 'gratitude'), join(f.root, root, 'linked-owner'));
    f.put(`${root}/vendor/browser/Ignored.js`, "import './Ignored.scss';");
    f.put(`${root}/vendor/browser/Ignored.scss`, '@error "Ignored vendor owner";');
    const bad = f.run();
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stderr, new RegExp(`${browser}/Gratitude\\.scss:`));
    assert.match(bad.stderr, /1 stylesheet\(s\) will not compile/);
    f.put(`${browser}/Gratitude.scss`, "@use '../shared'; .gratitude { color: shared.$color; }");
    const good = f.run();
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /2 entrypoint stylesheet\(s\) compiled/);
  });
}
