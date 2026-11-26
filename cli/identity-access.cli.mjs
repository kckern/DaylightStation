#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export async function main(argv, { env = process.env, output = process.stdout, errors = process.stderr, createInventory } = {}) {
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { since: { type: 'string' }, until: { type: 'string' }, 'log-store': { type: 'string' }, evidence: { type: 'string' } },
    });
    if (positionals.length !== 1 || positionals[0] !== 'inventory' || !values.since || !values.until) {
      throw new Error('Usage: identity-access inventory --since <UTC-start> --until <UTC-end> [--log-store <url>] [--evidence <private.json>]');
    }
    const logStoreUrl = values['log-store'] ?? env.DAYLIGHT_LOGSTORE;
    if (!logStoreUrl) throw new Error('Set DAYLIGHT_LOGSTORE or supply --log-store');
    const options = { logStoreUrl, evidencePath: values.evidence };
    const inventory = await (createInventory ?? loadInventory)(options);
    const report = await inventory.report({ since: values.since, until: values.until });
    output.write(JSON.stringify(report, null, 2) + '\n');
    return report.coverage.complete && report.unknown.length === 0 ? 0 : 2;
  } catch (error) {
    errors.write(`identity-access: ${error.message}\n`);
    return 1;
  }
}

async function loadInventory({ logStoreUrl, evidencePath }) {
  const [{ getConfigService }, { createAccessInventory }] = await Promise.all([
    import('./_bootstrap.mjs'),
    import('#composition/access/inventory.mjs'),
  ]);
  return createAccessInventory({ configService: await getConfigService(), logStoreUrl, evidencePath });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
