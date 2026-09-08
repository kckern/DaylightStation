/** Four allowlisted source transforms in memory; original source stays on disk. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(new URL('../fixtures/http-middleware.json', import.meta.url)));
const name = process.env.PRE_HTTP_MUTATION;
if (name && !Object.hasOwn(manifest.mutations, name)) throw new Error('Unknown HTTP mutation');
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context), mutation = manifest.mutations[name];
  if (!mutation || !url.startsWith('file:') || path.relative(root, fileURLToPath(url)) !== mutation.file) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  if (source.split(mutation.before).length !== 2) throw new Error('HTTP_MUTATION_ANCHOR_MISMATCH');
  process.stderr.write(JSON.stringify({ controlledHttpMutation: name, source: mutation.file }) + '\n');
  return { ...result, source: source.replace(mutation.before, mutation.after) };
}
