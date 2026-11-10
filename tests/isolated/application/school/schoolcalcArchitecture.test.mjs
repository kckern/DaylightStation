import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
// School lives in its app module now (__app_modules/learning/school/server/{domain,application,adapters,api});
// the boundaries these tests guard are the same, only the folders moved.
const SCHOOL_SERVER = path.join(ROOT, '__app_modules/learning/school/server');
const DOMAIN_ROOT = path.join(SCHOOL_SERVER, 'domain');
const SCHOOL_DOMAIN = DOMAIN_ROOT;
const SCHOOL_APP = path.join(SCHOOL_SERVER, 'application');
const SCHOOL_API = path.join(SCHOOL_SERVER, 'api');
// Pure, dependency-free contracts both tiers agree on (the old `#shared/contracts/`).
const PORTABLE_CONTRACTS = [path.join(ROOT, '__app_modules/learning/school/portable/contracts'), path.join(ROOT, 'shared/contracts')];
// Another module's domain is still a domain (the old `#domains/<other>/`): a
// file under any `server/domain/`, or a public facade that only re-exports one.
const DOMAIN_DIR = /[\\/]server[\\/]domain[\\/]/;
function isOtherDomain(file, specifier) {
  if (!specifier.startsWith('.')) return false;
  const target = resolveImport(file, specifier);
  if (DOMAIN_DIR.test(target)) return true;
  try {
    const reexports = importsFrom([target]);
    return reexports.length > 0 && /^\s*(?:export[^;]*from[^;]*;\s*|\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*$/.test(readFileSync(target, 'utf8'))
      && reexports.every(({ specifier: next }) => DOMAIN_DIR.test(resolveImport(target, next)));
  } catch { return false; }
}
const isContract = (file, specifier) => specifier.startsWith('.') && PORTABLE_CONTRACTS.some((dir) => inside(resolveImport(file, specifier), dir));
const SCHOOLCALC_APP = path.join(SCHOOL_APP, 'schoolcalc');
const SCHOOL_PORTS = path.join(SCHOOL_APP, 'ports');
const SCHOOLCALC_ADAPTERS = path.join(SCHOOL_SERVER, 'adapters/schoolcalc');
const PAPER_ADAPTER = path.join(SCHOOL_SERVER, 'adapters/paper');
const SCREEN_ADAPTER = path.join(SCHOOL_SERVER, 'adapters/screen');
const SCHOOLCALC_API = [
  path.join(SCHOOL_API, 'handlers/schoolcalc'),
  path.join(SCHOOL_API, 'schoolCalc.mjs'),
];

const FAMILY_OR_WIRE_TOKEN = /\b(?:TI-?86|TI-?89|Z80|ESP32|M5Stack|GraphLink|Silent Link|SCR1|SCP1|SCI1|SCC1|SCD1|SCQ1|SCA1|SCM1|SCL1|DSINFO|DSCAT|DSQ|DSACK|DSSYNC)\b/i;
const SUBJECT_BRANCH = /(?:case\s+['"](?:geography|chemistry|physics|economics|finance|mathematics|biology|history|scripture)['"]|(?:subject|course)(?:Id)?\s*===?\s*['"](?:geography|chemistry|physics|economics|finance|mathematics|biology|history|scripture)['"])/i;
const COMMERCE_VOCABULARY = /\b(?:purchase|price|checkout|shopping-cart|commerce|licensing)\b/i;

describe('SchoolCalc DDD and product boundaries', () => {
  it('keeps the School domain pure and independent of outer layers', () => {
    const violations = importsFrom(productionFiles(SCHOOL_DOMAIN)).filter(({ file, specifier }) => {
      if (specifier.startsWith('#domains/')) return false;
      // Shared contracts are pure, dependency-free modules both tiers agree on
      // (every file under shared/contracts imports only its siblings); other
      // domains already import them. `typeableText` is one (2026-09-14).
      if (specifier.startsWith('#shared/contracts/') || isContract(file, specifier) || isOtherDomain(file, specifier)) return false;
      if (specifier.startsWith('.')) return !inside(resolveImport(file, specifier), DOMAIN_ROOT);
      return true;
    });
    expect(violations, format(violations)).toEqual([]);
  });

  it('keeps SchoolCalc application use cases on domains, ports, and pure hashing only', () => {
    const files = [
      ...productionFiles(SCHOOLCALC_APP),
      ...productionFiles(SCHOOL_PORTS).filter((file) => path.basename(file).startsWith('ISchoolCalc')),
    ];
    const violations = importsFrom(files).filter(({ file, specifier }) => {
      if (specifier === 'node:crypto' || specifier === '#apps/common/stableRecord.mjs'
          || specifier.startsWith('#domains/') || isContract(file, specifier)) return false;
      // Relative imports may reach the School domain (the old `#domains/`) or stay in the application.
      if (specifier.startsWith('.')) return !inside(resolveImport(file, specifier), SCHOOL_APP) && !inside(resolveImport(file, specifier), DOMAIN_ROOT);
      return true;
    });
    expect(violations, format(violations)).toEqual([]);
  });

  it('contains no calculator-family, wire-format, or subject branch in domain/application production code', () => {
    const files = [
      ...productionFiles(path.join(SCHOOL_DOMAIN, 'schoolcalc')),
      ...productionFiles(path.join(SCHOOL_DOMAIN, 'catalog')),
      ...productionFiles(SCHOOLCALC_APP),
      ...productionFiles(SCHOOL_PORTS).filter((file) => path.basename(file).startsWith('ISchoolCalc')),
      // Paper/screen certification ports (spec §6.3/§6.4) are device-family
      // agnostic — they must stay just as free of TI-86/Z80-style
      // calculator-family and wire-format vocabulary as the schoolcalc
      // domain/application code above.
      ...productionFiles(PAPER_ADAPTER),
      ...productionFiles(SCREEN_ADAPTER),
    ];
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const out = [];
      if (FAMILY_OR_WIRE_TOKEN.test(source)) out.push({ file, reason: 'calculator-family or wire-format token' });
      if (inside(file, SCHOOLCALC_APP) && SUBJECT_BRANCH.test(source)) out.push({ file, reason: 'subject-specific branch vocabulary' });
      return out;
    });
    expect(violations, format(violations)).toEqual([]);
  });

  it('uses Catalog vocabulary without commerce semantics', () => {
    const files = [
      ...productionFiles(path.join(SCHOOL_DOMAIN, 'schoolcalc')),
      ...productionFiles(path.join(SCHOOL_DOMAIN, 'catalog')),
      ...productionFiles(SCHOOLCALC_APP),
      ...productionFiles(SCHOOLCALC_ADAPTERS),
      ...productionFiles(PAPER_ADAPTER),
      ...productionFiles(SCREEN_ADAPTER),
      ...SCHOOLCALC_API.flatMap((entry) => (statSync(entry).isDirectory() ? productionFiles(entry) : [entry])),
    ];
    const violations = files.flatMap((file) => COMMERCE_VOCABULARY.test(readFileSync(file, 'utf8'))
      ? [{ file, reason: 'commerce vocabulary in SchoolCalc production code' }]
      : []);
    expect(violations, format(violations)).toEqual([]);
  });

  it('does not encode ranking, ability-tier, or permanent-placement outputs in School production code', () => {
    const files = [
      ...productionFiles(SCHOOL_DOMAIN),
      ...productionFiles(SCHOOL_APP),
      path.join(SCHOOL_API, 'school.mjs'),
    ];
    const forbiddenField = /\b(?:abilityTier|abilityLevel|learnerRank|rankings)\s*:/;
    const violations = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const out = [];
      if (forbiddenField.test(source)) out.push({ file, reason: 'tracking-shaped output field' });
      for (const field of ['learnerRanking', 'permanentAbilityLabels', 'fixedPlacement']) {
        const assignments = [...source.matchAll(new RegExp(`\\b${field}\\s*:\\s*([^,}\\n]+)`, 'g'))];
        if (assignments.some((match) => match[1].trim() !== 'false')) {
          out.push({ file, reason: `${field} must only be an explicit false constraint` });
        }
      }
      return out;
    });
    expect(violations, format(violations)).toEqual([]);
  });

  it('keeps calculator-family implementations in adapters without outward dependencies', () => {
    const violations = importsFrom(productionFiles(SCHOOLCALC_ADAPTERS)).filter(({ file, specifier }) => {
      if (specifier.startsWith('node:')) return false;
      if (specifier.startsWith('#domains/')) return false;
      if (specifier.startsWith('#apps/school/ports/')) return false;
      if (specifier.startsWith('#system/utils/') || isContract(file, specifier)) return false;
      // Relative imports may reach the domain or the School ports (the old aliases).
      if (specifier.startsWith('.')) {
        const target = resolveImport(file, specifier);
        return !inside(target, SCHOOLCALC_ADAPTERS) && !inside(target, DOMAIN_ROOT) && !inside(target, SCHOOL_PORTS);
      }
      return true;
    });
    expect(violations, format(violations)).toEqual([]);
  });

  it('keeps the SchoolCalc HTTP surface injection-only and representation-thin', () => {
    const files = SCHOOLCALC_API.flatMap((entry) => (statSync(entry).isDirectory() ? productionFiles(entry) : [entry]));
    const violations = importsFrom(files).filter(({ file, specifier }) => {
      if (specifier === 'express' || specifier === '#system/http/middleware/index.mjs') return false;
      if (specifier.startsWith('.')) return !inside(resolveImport(file, specifier), SCHOOL_API);
      return true;
    });
    const implementationLeak = files.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return FAMILY_OR_WIRE_TOKEN.test(source) || /new\s+\w*SchoolCalc\w*\s*\(/.test(source)
        ? [{ file, reason: 'device decoding or use-case construction in HTTP layer' }]
        : [];
    });
    expect([...violations, ...implementationLeak], format([...violations, ...implementationLeak])).toEqual([]);
  });

  it('mounts the child API through an injected router rather than importing its implementation', () => {
    const source = readFileSync(path.join(SCHOOL_API, 'school.mjs'), 'utf8');
    expect(source).toContain('schoolCalcRouter = null');
    expect(source).toContain("router.use('/calc', schoolCalcRouter)");
    expect(source).not.toMatch(/from ['"][^'"]*schoolCalc/i);
  });
});

function productionFiles(entry) {
  if (!statSync(entry).isDirectory()) return [entry];
  return readdirSync(entry).flatMap((name) => {
    const current = path.join(entry, name);
    if (statSync(current).isDirectory()) return productionFiles(current);
    return current.endsWith('.mjs') && !current.endsWith('.test.mjs') ? [current] : [];
  });
}

function importsFrom(files) {
  return files.flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const imports = [];
    const lines = source.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\s*(?:import|export)\b/.test(lines[index])) continue;
      let statement = lines[index];
      while (!statement.includes(';') && index + 1 < lines.length) statement += `\n${lines[++index]}`;
      const match = statement.match(/\bfrom\s*['"]([^'"]+)['"]/) ?? statement.match(/^\s*import\s*['"]([^'"]+)['"]/);
      if (match) imports.push({ file, specifier: match[1] });
    }
    return imports;
  });
}

function resolveImport(file, specifier) {
  return path.resolve(path.dirname(file), specifier);
}

function inside(candidate, directory) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function format(violations) {
  return violations.map((entry) => `${path.relative(ROOT, entry.file)}: ${entry.specifier ?? entry.reason}`).join('\n');
}
