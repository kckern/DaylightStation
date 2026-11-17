import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../../scripts/audit-ui-tokens.mjs', import.meta.url));
const roots = [];
function run(files, baseline = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'school-ui-guard-')); roots.push(cwd);
  const put = (name, value) => { const file = path.join(cwd, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
  put('scripts/audit-ui-tokens.baseline.json', '{}');
  put('scripts/audit-ui-school.baseline.json', JSON.stringify({ files: baseline }));
  for (const [name, value] of Object.entries(files)) put(`__app_modules/learning/school/browser/${name}`, value);
  return spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('School UI guard CLI coverage', () => {
  it.each([
    ['portal/New.jsx', 'export default () => <button>Go</button>;', 'native-control'],
    ['portal/Multiline.jsx', 'export default () => <button\n type="button">Go</button>;', 'native-control'],
    ['runtime/Multiline.js', "window.addEventListener(\n 'keydown', handler);", 'raw-keydown'],
    ['runtime/New.js', "window.addEventListener('keydown', handle);", 'raw-keydown'],
    ['activities/New.scss', '.new { color: #ff00ff; }', 'raw-color'],
    ['portal/New.scss', '.new { color: var(--ds-unknown); }', 'undefined-token'],
  ])('rejects new School mechanism debt in %s', (file, source, rule) => {
    const result = run({ [file]: source });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(file);
    expect(result.stdout).toContain(rule);
  });

  it('keeps reviewed legacy allowances tied to their existing file', () => {
    const baseline = { 'legacy/Old.scss': { 'raw-color': 1 } };
    expect(run({ 'legacy/Old.scss': '.old { color: #fff; }' }, baseline).status).toBe(0);
    const moved = run({ 'legacy/New.scss': '.new { color: #fff; }' }, baseline);
    expect(moved.status).toBe(1);
    expect(moved.stdout).toContain('legacy/New.scss');
  });

  it('does not let a baseline waive new portal semantic colors', () => {
    const result = run({ 'portal/New.scss': '.new { color: #fff; background: var(--ds-surface); }' }, { 'portal/New.scss': { 'raw-color': 4 } });
    expect(result.status).toBe(1);
  });

  it('does not exempt unrelated listeners added beside the shared dispatcher', () => {
    const result = run({ 'portal/useSchoolCommands.js': "window.addEventListener('keydown', dispatch);\nwindow.addEventListener('keydown', surprise);" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('raw-keydown');
  });

  it('allows reviewed art annotations, comments and the actual shared dispatcher listener', () => {
    const result = run({
      'portal/Art.scss': '.art { fill: #f0f; } // data-art: illustrated marker\n// legacy palette #fff is not rendered',
      'portal/useSchoolCommands.js': "window.addEventListener('keydown', dispatch);",
      'portal/Good.scss': '.good { color: var(--ds-text-high); }',
    });
    expect(result.status).toBe(0);
  });
});
