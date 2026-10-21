#!/usr/bin/env node
/**
 * Mirror an outside weekly class into home notes, driven by one config file
 * (`school.class-board/v1`, kept with the household data — see
 * __docs/reference/school/class-board.md).
 *
 *   sync  --config <file>                       archive the board's posts
 *   notes --config <file> [--from D] [--to D]   write dated teacher notes
 *   run   --config <file> [--day D]             sync, then notes for one day
 *
 * Writes (archive files, teacher notes) need --apply; without it nothing is
 * written and the plan is printed. --base defaults to DAYLIGHT_BASE_PATH; the
 * config's paths are relative to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { addDays, classNotes, compileParse, pick, postRecord } from './lib/class-board.mjs';
import { YamlTeacherNotes } from '../server/adapters/persistence/YamlTeacherNotes.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  config: { type: 'string' }, base: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
  day: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
const fail = (message) => { process.stderr.write(`${message}\n`); process.exit(1); };
const say = (line) => process.stdout.write(`${line}\n`);
const dump = (value) => yaml.dump(value, { noRefs: true, lineWidth: -1 });

const command = positionals[0];
if (!['sync', 'notes', 'run'].includes(command) || !values.config) fail('Usage: class-board sync|notes|run --config <file> [--base <dir>] [--from D --to D | --day D] [--apply]');
const base = values.base ?? process.env.DAYLIGHT_BASE_PATH;
if (!base) fail('class-board: pass --base or set DAYLIGHT_BASE_PATH');
const config = yaml.load(fs.readFileSync(path.resolve(base, values.config), 'utf8'));
if (config?.schema !== 'school.class-board/v1') fail(`class-board: ${values.config} is not a school.class-board/v1 config`);
for (const key of ['learner', 'timezone', 'calendar', 'archive', 'source', 'parse', 'notes']) if (!config[key]) fail(`class-board config: ${key} is required`);
const rules = compileParse(config.parse);
const archive = path.resolve(base, config.archive);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());

async function sync() {
  const { url, method = 'POST', headers = {}, body, ok, posts, fields } = config.source;
  if (!url || !posts || !fields) fail('class-board config: source.url, source.posts and source.fields are required');
  const response = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => null);
  const list = pick(payload, posts);
  if (!response.ok || (ok && !pick(payload, ok)) || !Array.isArray(list)) fail(`class-board sync: board fetch failed (HTTP ${response.status})`);
  if (values.apply) fs.mkdirSync(archive, { recursive: true });
  let changed = 0;
  for (const post of list) {
    const record = postRecord(post, { fields, rules });
    const file = path.join(archive, `${record.classDate ?? 'undated'}-${record.postId}.yml`);
    const existing = fs.existsSync(file) ? yaml.load(fs.readFileSync(file, 'utf8')) : null;
    if (existing?.updatedAt === record.updatedAt) continue;
    changed += 1;
    if (values.apply) fs.writeFileSync(file, dump(record));
    say(`${existing ? 'updated' : 'new'}  ${path.basename(file)}  homework: ${record.homework ?? '—'}`);
  }
  say(`${list.length} posts, ${changed} ${values.apply ? 'written' : 'to write'}`);
}

async function notes(from, to) {
  const calendar = yaml.load(fs.readFileSync(path.resolve(base, config.calendar), 'utf8'));
  const records = fs.existsSync(archive)
    ? fs.readdirSync(archive).filter((name) => name.endsWith('.yml')).map((name) => yaml.load(fs.readFileSync(path.join(archive, name), 'utf8')))
    : [];
  const store = new YamlTeacherNotes({ configService: { getHouseholdPath: (rel) => path.join(base, 'data/household', rel) }, logger: { info() {}, error: (event) => process.stderr.write(`${event}\n`) } });
  const existing = new Set(store.list({ includeRetracted: true }).map((entry) => entry.id));
  const planned = classNotes({ notes: config.notes, calendar, records, learnerId: config.learner, from, to, timeZone: config.timezone, by: config.by ?? null });
  for (const note of planned) {
    const skip = existing.has(note.id);
    say(`${skip ? 'exists' : values.apply ? 'append' : 'would append'}  ${note.at}  ${note.note}`);
    if (!skip && values.apply) await store.append(note);
  }
}

if (command === 'sync' || command === 'run') await sync();
if (command === 'notes') await notes(values.from ?? today, values.to ?? addDays(values.from ?? today, 6));
if (command === 'run') await notes(values.day ?? today, values.day ?? today);
if (!values.apply) say('(dry run — pass --apply to write)');
