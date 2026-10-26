// Disposable authority fixture: real production repositories, no household services.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { fileURLToPath } from 'node:url';
import { createGamingSessionRuntime } from '../../__capabilities/gaming/server/composition/session-runtime.mjs';
import { YamlGamingDefinitionStore } from '../../__app_modules/games/party-games/server/adapters/persistence/YamlGamingDefinitionStore.mjs';
import { GamingApplication } from '../../__app_modules/games/party-games/server/application/runtime/GamingApplication.mjs';
import { jeopardyRuleModule } from '../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';

export async function createDurableJeopardyFixture({ clock = { now: () => new Date() }, definition = null, definitionId = 'jeopardy:test' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-authority-'));
  const source = definition || YAML.parse(fs.readFileSync(fileURLToPath(new URL('../_fixtures/group-play/jeremiah-open-book.yml', import.meta.url)), 'utf8'));
  const id = definitionId;
  const directory = path.join(root, 'definitions', id); fs.mkdirSync(directory, { recursive: true });
  const { rule_module = { id: 'jeopardy', version: 1 }, experience = { id: 'jeopardy', version: 1 }, artifact: _artifact, ...content } = source;
  fs.writeFileSync(path.join(directory, 'rules.yml'), YAML.stringify({ artifact: { kind: 'gaming-rules', version: 1, id }, rule_module, experience }));
  fs.writeFileSync(path.join(directory, 'content.yml'), YAML.stringify({ artifact: { kind: 'gaming-content', version: 1, id }, ...content }));
  const manifest = { id: 'jeopardy', version: 1, hash: 'b'.repeat(64), setup: { kind: 'teams', host_modes: ['human'] }, surfaces: [{ id: 'party-games', presenter: 'jeopardy-board', authority_modes: ['remote'] }] };
  const restart = () => {
    const definitions = new YamlGamingDefinitionStore({ definitionsDir: path.join(root, 'definitions'), archiveDir: path.join(root, 'archive') });
    const authority = createGamingSessionRuntime({ definitions, snapshotsDir: path.join(root, 'snapshots'), journalsDir: path.join(root, 'journals'), rulesets: [jeopardyRuleModule], clock,
      createIds: () => ({ session: () => `game:${crypto.randomUUID()}`, command: () => `cmd:${crypto.randomUUID()}`, seed: () => 7 }) });
    const application = new GamingApplication({ coordinator: authority.coordinator, definitions, manifestStore: { get: () => manifest, list: () => [manifest] } });
    return { ...authority, application, definitions };
  };
  return { ...restart(), root, restart, dispose: () => fs.rmSync(root, { recursive: true, force: true }) };
}
