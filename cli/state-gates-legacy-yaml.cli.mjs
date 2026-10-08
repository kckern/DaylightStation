#!/usr/bin/env node
// Convert State Gates current.json (v2) back to the v1 current.yml a pre-JSON
// build reads, for a deliberate rollback. Run inside the container:
//   node cli/state-gates-legacy-yaml.cli.mjs data/household/state-gates/current.json data/household/state-gates/current.yml
// Then move current.json aside (never delete). See
// docs/reference/state-gates/integration-and-operations.md#rollback.
import { readTextFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';
import { toLegacyV1 } from '#adapters/state-gates/persistence/YamlStateGatesStateEngine.mjs';

const [from, to] = process.argv.slice(2);
if (!from || !to) {
  process.stderr.write('usage: state-gates-legacy-yaml.cli.mjs <current.json> <current.yml>\n');
  process.exit(2);
}
const state = JSON.parse(readTextFromPath(from));
saveYamlToPathAtomic(to, toLegacyV1(state), { noRefs: true, sortKeys: true });
process.stdout.write(`wrote ${to} (household revision ${state.projection?.householdRevision ?? 0})\n`);
