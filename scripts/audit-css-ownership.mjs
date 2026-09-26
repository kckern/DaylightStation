// CSS ownership gate. Baseline-style like audit-ui-tokens.mjs: existing
// violations don't block, growth does.
//
// WHY. main.jsx lazy-loads each app route, so a page gets only the CSS its own
// module graph imports. A component that renders a class defined ONLY in an
// app-level stylesheet (frontend/src/Apps/<Name>App.scss) is styled only while
// that app happens to be loaded. Piano components mounted on the office screen
// without Apps/PianoApp.jsx lost their styles and tokens that way.
//
// RULE. A component imports every stylesheet whose classes it uses. A class
// defined only in an app stylesheet may be used only by that app's own entry
// (Apps/<Name>App.jsx) and that app's own module folder.
//
// HOW. For each Apps/*.scss, collect every class selector it defines (nested
// SCSS `&__el` / `&--mod` expanded against the parent block). Drop classes
// that any non-app stylesheet also defines. Then scan the string literals of
// every frontend .js/.jsx file (tests excluded) for whole className tokens; a
// token naming one of those classes, in a file outside the owning app's area,
// is a violation. Counts are per app, compared with the baseline file.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const SRC = 'frontend/src';
const APPS_DIR = `${SRC}/Apps`;
const BASELINE_PATH = 'scripts/audit-css-ownership.baseline.json';

// An app's own module folder, where it differs from modules/<Base>/ (Base =
// the app name without "App"). Piano's module folder is shared with surfaces
// that mount without the kiosk shell (games, the office-screen visualizer), so
// only the kiosk shell's folder counts as PianoApp's own.
const OWN_FOLDER_OVERRIDES = {
  PianoApp: [`${SRC}/modules/Piano/PianoKiosk/`],
  FinanceApp: [`${SRC}/modules/Finances/`],
};

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '_deleteme', '.vite']);
// Only compound names (a hyphen or underscore) count as class tokens. A bare
// word — `month`, `memo`, `reload` — is indistinguishable from a data string,
// and this codebase names classes BEM-style, so single words are noise here.
const CLASS_TOKEN = /^-?[_a-zA-Z][\w-]*[-_][\w-]*$/;

// String literals that happen to spell an app-only class but are data, not a
// className. Keyed by class, matched against the using file's path.
const KNOWN_DATA_STRINGS = [
  { cls: 'piano-course', file: /\/modules\/School\//, why: "School's program id 'piano-course'" },
];

// ── SCSS: class selectors a stylesheet defines ──────────────────────────────

function stripCssComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    // `//` line comment — but not the `//` of a url(http://…).
    if (c === '/' && src[i + 1] === '/' && src[i - 1] !== ':') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function splitSelectorList(prelude) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of prelude) {
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function resolveSelectors(prelude, parents) {
  const parts = splitSelectorList(prelude);
  if (!parents || parents.length === 0) return parts;
  const out = [];
  for (const part of parts) {
    for (const parent of parents) {
      out.push(part.includes('&') ? part.split('&').join(parent) : `${parent} ${part}`);
    }
  }
  return out;
}

/** Every class name a stylesheet's selectors define (nesting expanded). */
export function extractScssClasses(source) {
  const src = stripCssComments(source);
  const classes = new Set();
  // Stack entries: resolved selector list for a rule, the parent's list for a
  // transparent at-rule (@media, @supports, @include …), or null inside a
  // context that holds no selectors (@keyframes, @function, @mixin bodies' args).
  const stack = [];
  let buf = '';
  const top = () => (stack.length ? stack[stack.length - 1] : []);
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '#' && src[i + 1] === '{') {
      // Interpolation: keep it opaque in the buffer.
      const end = src.indexOf('}', i);
      buf += src.slice(i, end === -1 ? src.length : end + 1);
      i = end === -1 ? src.length : end;
      continue;
    }
    if (c === '{') {
      const prelude = buf.trim();
      buf = '';
      const parent = top();
      if (parent === null) { stack.push(null); continue; }
      if (prelude.startsWith('@')) {
        const name = prelude.slice(1).split(/[\s(]/)[0];
        stack.push(/^(-\w+-)?keyframes$|^function$|^font-face$|^page$/.test(name) ? null : parent);
        continue;
      }
      const resolved = resolveSelectors(prelude, parent);
      for (const sel of resolved) {
        // Pseudo-class arguments (:not(.x), :has(.y)) name classes the rule
        // does not style, so drop them before collecting.
        const bare = sel.replace(/:(not|has|is|where)\([^)]*\)/g, '').replace(/#\{[^}]*\}/g, '');
        for (const m of bare.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(m[1]);
      }
      stack.push(resolved);
      continue;
    }
    if (c === '}') { stack.pop(); buf = ''; continue; }
    if (c === ';') { buf = ''; continue; }
    buf += c;
  }
  return classes;
}

// ── JS: className tokens a source file uses ─────────────────────────────────

/** Whole class-name tokens found in a JS/JSX file's string literals. */
export function extractClassTokens(source) {
  const tokens = new Set();
  const addFrom = (text) => {
    for (const t of text.split(/\s+/)) if (CLASS_TOKEN.test(t)) tokens.add(t);
  };
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      let j = i + 1;
      let text = '';
      let depth = 0; // ${ … } nesting inside a template literal
      while (j < n) {
        const d = source[j];
        if (d === '\\') { j += 2; continue; }
        if (quote === '`' && depth === 0 && d === '$' && source[j + 1] === '{') {
          addFrom(text); text = ''; depth = 1; j += 2; continue;
        }
        if (depth > 0) {
          // Inside ${ … }: track brace depth and collect the expression's own
          // quoted literals (`${on ? ' is-active' : ''}`).
          if (d === '{') depth += 1;
          else if (d === '}') { depth -= 1; if (depth === 0) { j += 1; continue; } }
          else if (d === "'" || d === '"') {
            const q = d; let k = j + 1; let inner = '';
            while (k < n && source[k] !== q) { if (source[k] === '\\') k += 1; else inner += source[k]; k += 1; }
            addFrom(inner); j = k + 1; continue;
          }
          j += 1;
          continue;
        }
        if (d === quote) break;
        if (quote !== '`' && d === '\n') break; // unterminated / regex false start
        text += d;
        j += 1;
      }
      addFrom(text);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return tokens;
}

// ── Scan ────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), out);
    } else out.push(path.join(dir, entry.name).split(path.sep).join('/'));
  }
  return out;
}

function ownAreaFor(app) {
  const base = app.replace(/App$/, '');
  const folders = OWN_FOLDER_OVERRIDES[app]
    ?? (fs.existsSync(`${SRC}/modules/${base}`) ? [`${SRC}/modules/${base}/`] : []);
  return { entry: `${APPS_DIR}/${app}.jsx`, folders };
}

function inArea(file, area) {
  return file === area.entry || area.folders.some((f) => file.startsWith(f));
}

/**
 * Pure core: given app sheets, other sheets and JS files (path → source),
 * return violations [{ app, cls, file }].
 */
export function findViolations({ appSheets, otherSheets, jsFiles, areas }) {
  const shared = new Set();
  for (const src of Object.values(otherSheets)) for (const c of extractScssClasses(src)) shared.add(c);

  const appOnly = {}; // app → Set(class)
  for (const [app, src] of Object.entries(appSheets)) {
    appOnly[app] = new Set([...extractScssClasses(src)].filter((c) => !shared.has(c)));
  }

  const violations = [];
  for (const [file, src] of Object.entries(jsFiles)) {
    const tokens = extractClassTokens(src);
    for (const [app, classes] of Object.entries(appOnly)) {
      if (inArea(file, areas[app])) continue;
      for (const t of tokens) {
        if (!classes.has(t)) continue;
        if (KNOWN_DATA_STRINGS.some((k) => k.cls === t && k.file.test(file))) continue;
        // Another app that defines the same class in its own sheet, used from
        // inside that app, is that app's business, not this one's.
        const coveredElsewhere = Object.entries(appOnly).some(
          ([other, cs]) => other !== app && cs.has(t) && inArea(file, areas[other]),
        );
        if (!coveredElsewhere) violations.push({ app, cls: t, file });
      }
    }
  }
  return violations;
}

function main() {
  const baseline = fs.existsSync(BASELINE_PATH)
    ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
    : {};
  const write = process.argv.includes('--write-baseline');
  const verbose = process.argv.includes('--verbose');

  const appSheets = {};
  const areas = {};
  for (const f of fs.readdirSync(APPS_DIR).filter((x) => x.endsWith('.scss')).sort()) {
    const app = f.replace(/\.scss$/, '');
    appSheets[app] = fs.readFileSync(`${APPS_DIR}/${f}`, 'utf8');
    areas[app] = ownAreaFor(app);
  }
  const otherSheets = {};
  const jsFiles = {};
  for (const file of walk(SRC)) {
    if (/\.(scss|css)$/.test(file)) {
      if (path.posix.dirname(file) === APPS_DIR) continue;
      otherSheets[file] = fs.readFileSync(file, 'utf8');
    } else if (/\.(jsx|js)$/.test(file)) {
      if (/\.test\.|\.spec\.|\/__tests__\//.test(file)) continue;
      jsFiles[file] = fs.readFileSync(file, 'utf8');
    }
  }

  const violations = findViolations({ appSheets, otherSheets, jsFiles, areas });
  const counts = {};
  for (const app of Object.keys(appSheets)) counts[app] = 0;
  for (const v of violations) counts[v.app] += 1;

  if (write) {
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
    console.log(`wrote ${BASELINE_PATH}`);
  }

  let failed = false;
  for (const [app, n] of Object.entries(counts)) {
    const base = write ? n : (baseline[app] ?? 0);
    const ok = n <= base;
    if (!ok) failed = true;
    console.log(`${app.padEnd(14)} ${String(n).padStart(4)} (baseline ${base}) ${ok ? 'ok' : 'FAIL'}`);
    if (!ok || verbose) {
      for (const v of violations.filter((x) => x.app === app).slice(0, verbose ? Infinity : 30)) {
        console.log(`  .${v.cls}  ${v.file}`);
      }
    }
  }
  if (failed) {
    console.log('\nA class defined only in an app stylesheet is used outside that app.');
    console.log('Move its rules into a stylesheet the rendering component imports.');
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] === url.fileURLToPath(import.meta.url)) main();
