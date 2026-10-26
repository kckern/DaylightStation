// Read-only comparison of authored content after the same normalization as play.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { validateGameSet } from '../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { stableSha256 } from '../__capabilities/gaming/portable/kernel/index.mjs';

function normalized(raw) {
  const result = validateGameSet(raw);
  if (!result.valid) throw Object.assign(new Error(result.errors.join('; ')), { code: 'invalid_content' });
  return result.set;
}
function compare(expected, actual, at, differences) {
  if (Object.is(expected, actual)) return;
  if (expected && actual && typeof expected === 'object' && typeof actual === 'object' && Array.isArray(expected) === Array.isArray(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      compare(expected[key], actual[key], Array.isArray(expected) ? `${at}[${key}]` : at ? `${at}.${key}` : key, differences);
    }
    return;
  }
  differences.push({ path: at, expected, actual });
}
export function auditJeopardyContent({ expected, actual }) {
  const left = normalized(expected), right = normalized(actual), differences = [];
  compare(left, right, '', differences);
  return { matches: differences.length === 0, differences };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [expectedFile, actualFile] = process.argv.slice(2);
    if (!expectedFile || !actualFile) throw Object.assign(new Error('expected and actual files required'), { code: 'usage' });
    const read = file => YAML.parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
    const expected = read(expectedFile), actual = read(actualFile), result = auditJeopardyContent({ expected, actual });
    // Differences can contain answers in memory; output only paths and identities.
    process.stdout.write(JSON.stringify({ matches: result.matches, paths: result.differences.map(d => d.path), expectedHash: stableSha256(normalized(expected)), actualHash: stableSha256(normalized(actual)) }) + '\n');
    process.exitCode = result.matches ? 0 : 1;
  } catch (error) {
    process.stderr.write(`Jeopardy content audit failed (${error.code || 'invalid_content'}).\n`);
    process.exitCode = 2;
  }
}
