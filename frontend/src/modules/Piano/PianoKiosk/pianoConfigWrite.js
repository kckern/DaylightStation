// pianoConfigWrite.js — write one value into the household piano config.
//
// The household piano config is ONE YAML file served by
// GET/PUT api/v1/admin/apps/piano/config (AppsConfigService; the PUT replaces
// the whole file). Round-tripping the parsed object would drop every comment in
// a hand-maintained file, so this edits the RAW text with the `yaml` Document
// API, which keeps comments and layout, and PUTs `{ raw }` back.
//
// Placement mirrors resolvePianoConfig: when the file has a `pianos.{pianoId}`
// block the value goes there (a per-piano measurement stays per piano);
// otherwise it goes on the shared top level, which is what the synthesized
// 'default' piano reads.

import { parseDocument } from 'yaml';
import { DaylightAPI } from '../../../lib/api.mjs';

const CONFIG_PATH = 'api/v1/admin/apps/piano/config';

/** Where a key lands for this piano, as a path array. Pure; exported for tests. */
export function pianoConfigKeyPath(doc, pianoId, keyPath) {
  const perPiano = pianoId && doc.hasIn(['pianos', pianoId]);
  return perPiano ? ['pianos', pianoId, ...keyPath] : [...keyPath];
}

/** Apply one set to raw YAML text. Pure; exported for tests. */
export function setPianoConfigValue(raw, pianoId, keyPath, value) {
  const doc = parseDocument(raw ?? '');
  if (doc.errors?.length) throw new Error(`piano config is not valid YAML: ${doc.errors[0].message}`);
  const path = pianoConfigKeyPath(doc, pianoId, keyPath);
  doc.setIn(path, value);
  return { raw: String(doc), path: path.join('.'), parsed: doc.toJS() };
}

/**
 * Read the current file, set `keyPath` for `pianoId`, write it back.
 * Refuses to write when the current file could not be read, so a failed GET can
 * never become an empty file.
 * @returns {Promise<{ path:string, parsed:object }>}
 */
export async function writePianoConfigValue({ pianoId, keyPath, value, api = DaylightAPI }) {
  const current = await api(CONFIG_PATH);
  if (typeof current?.raw !== 'string') throw new Error('could not read the current piano config');
  const next = setPianoConfigValue(current.raw, pianoId, keyPath, value);
  const result = await api(CONFIG_PATH, { raw: next.raw }, 'PUT');
  if (result?.ok === false) throw new Error(result.error || 'write rejected');
  return { path: next.path, parsed: next.parsed };
}
