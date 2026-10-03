#!/usr/bin/env node
// media-routines.cli.mjs — show the household's playback routines and push
// them to the Media app's routine catalog.
//
// Why this exists: routines live in the Home Assistant config, which the app
// container does not mount. The app reads it in place where it can (system
// config media-routines.yml `homeAssistant.configDir`); elsewhere it uses the
// last snapshot imported through PUT /api/v1/media/routines/catalog. Run this
// on a machine that can read the HA config after changing an automation.
//
// Usage:
//   node cli/media-routines.cli.mjs list  --dir <HA _includes dir>
//   node cli/media-routines.cli.mjs push  --dir <HA _includes dir> [--url http://localhost:3111]
//   node cli/media-routines.cli.mjs show  [--url http://localhost:3111]     # what the app has now
//
// --dir defaults to $HA_INCLUDES_DIR; --url to $DAYLIGHT_URL, then http://localhost:3111.
// Exit code 1 when nothing could be read or the app refused the import.

import { HomeAssistantRoutineFileSource } from '../backend/src/1_adapters/home-automation/HomeAssistantRoutineFileSource.mjs';
import { extractRoutines } from '../backend/src/2_domains/media/routineCatalog.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const command = process.argv[2] || 'list';
const dir = arg('dir', process.env.HA_INCLUDES_DIR || null);
const url = (arg('url', process.env.DAYLIGHT_URL || 'http://localhost:3111')).replace(/\/$/, '');
const quiet = { warn: (event, data) => process.stderr.write(`${event} ${JSON.stringify(data)}\n`), debug() {} };

function print(routines) {
  for (const r of routines) {
    const targets = r.targets.map((t) => `${t.deviceId}${t.query ? `?${t.query}` : ''}`).join('  ');
    process.stdout.write(`${r.id.padEnd(48)} ${String(r.name).padEnd(40)} ${targets}\n`);
  }
  process.stdout.write(`${routines.length} routine(s)\n`);
}

async function readConfig() {
  const source = new HomeAssistantRoutineFileSource({ configDir: dir, logger: quiet });
  if (!source.available()) {
    process.stderr.write(`Home Assistant config not readable at ${dir ?? '(no --dir)'}\n`);
    process.exit(1);
  }
  return source.read();
}

async function main() {
  if (command === 'list') {
    print(extractRoutines(await readConfig()));
    return;
  }
  if (command === 'push') {
    const config = await readConfig();
    const res = await fetch(`${url}/api/v1/media/routines/catalog`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, source: 'media-routines.cli' }),
    });
    const body = await res.json().catch(() => ({}));
    process.stdout.write(`${res.status} ${JSON.stringify(body)}\n`);
    if (!res.ok) process.exit(1);
    return;
  }
  if (command === 'show') {
    const res = await fetch(`${url}/api/v1/media/routines`);
    const body = await res.json();
    print(body.routines || []);
    process.stdout.write(`sources: ${JSON.stringify(body.sources)}\n`);
    return;
  }
  process.stderr.write(`unknown command: ${command} (list | push | show)\n`);
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
