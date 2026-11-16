import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** A client of the installed authority. This process never constructs a writable repository. */
export async function runAgendaCli(argv, {
  fetchImpl = fetch,
  env = process.env,
  stdout = process.stdout
} = {}) {
  const [group, command, ...args] = argv;
  if (group !== 'migration' || !['dry-run', 'apply', 'backout-preview', 'backout'].includes(command)) throw Error('Usage: agenda migration dry-run|apply|backout-preview|backout --server URL [--manifest FILE] [--output FILE] [--review-digest SHA256] [--plan-id ID] [--backout-review FILE] [--backout-digest SHA256]');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--server', '--manifest', '--output', '--review-digest', '--plan-id', '--backout-review', '--backout-digest'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw Error('Invalid CLI option');
    options[args[i]] = args[i + 1];
  }
  const server = options['--server'] ?? env.DAYLIGHT_AGENDA_SERVER;
  if (!server || !env.DAYLIGHT_AGENDA_TOKEN) throw Error('Installed server URL and DAYLIGHT_AGENDA_TOKEN required');
  const url = new URL(server);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('Invalid server URL');
  let body = {};
  if (command !== 'dry-run') {
    if (!options['--manifest'] || !options['--review-digest']) throw Error('Reviewed manifest and explicit review digest required');
    const reviewedManifest = JSON.parse(readFileSync(options['--manifest'], 'utf8'));
    body = {
      reviewedManifest,
      reviewDigest: options['--review-digest'],
      ...(command === 'apply' ? {
        expectedSourceHashes: reviewedManifest.sourceHashes
      } : {
        planId: options['--plan-id']
      })
    };
    if (['backout', 'backout-preview'].includes(command) && !body.planId) throw Error('Explicit selected plan ID required for backout');
  }
  if (command === 'backout') {
    if (!options['--backout-review'] || !options['--backout-digest']) throw Error('Reviewed backout preview and explicit backout digest required');
    body.reviewedBackout = JSON.parse(readFileSync(options['--backout-review'], 'utf8'));
    body.backoutDigest = options['--backout-digest'];
  }
  const preview = ['dry-run', 'backout-preview'].includes(command);
  if (preview && !options['--output']) throw Error('A private --output review path is required');
  const response = await fetchImpl(new URL(`/api/v1/admin/agenda-migration/${command}`, url), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DAYLIGHT_AGENDA_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    redirect: 'error'
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(`Migration refused: ${result.code ?? response.status}`), {
    code: result.code
  });
  if (preview) {
    writeFileSync(options['--output'], JSON.stringify(result, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx'
    });
  }
  stdout.write(JSON.stringify({
    digest: result.digest,
    phase: result.phase ?? command,
    ...(result.sourceHashes ? {
      sourceHashes: result.sourceHashes,
      conflicts: result.identityChanges.conflicts.length
    } : {}),
    ...(options['--output'] ? {
      manifest: options['--output']
    } : {})
  }) + '\n');
  return result;
}
export function runCliEntry() {
  runAgendaCli(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) runCliEntry();
