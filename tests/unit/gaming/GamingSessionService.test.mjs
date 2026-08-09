import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { YamlGamingDefinitionStore } from '../../../backend/src/1_adapters/persistence/yaml/gaming/YamlGamingDefinitionStore.mjs';
import { YamlGamingSessionStore } from '../../../backend/src/1_adapters/persistence/yaml/gaming/YamlGamingSessionStore.mjs';
import { GamingSessionService } from '../../../backend/src/3_applications/gaming/GamingSessionService.mjs';
import { scaleClashDefinition } from '../../../shared/gaming/fixtures/scaleClash.mjs';

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function service() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gaming-service-'));
  scratch.push(root);
  const definitionStore = new YamlGamingDefinitionStore({
    definitionsDir: path.join(root, 'games'),
    archiveDir: path.join(root, 'definitions'),
    builtIns: { 'scale-clash': scaleClashDefinition },
    builtInFiles: {
      'card-game': path.resolve('shared/gaming/definitions/card-game.yml'),
    },
  });
  const sessionStore = new YamlGamingSessionStore({ sessionsDir: path.join(root, 'sessions') });
  return new GamingSessionService({
    definitionStore,
    sessionStore,
    idFactory: () => 'game_12345678',
    clock: () => new Date('2026-08-09T12:00:00.000Z'),
  });
}

describe('GamingSessionService', () => {
  it('loads the Card Game from YAML and creates scale challenges', () => {
    const svc = service();
    const loaded = svc.getDefinition('card-game');
    expect(loaded.definition.title).toBe('Card Game');
    expect(Object.values(loaded.definition.cards).every((card) => card.challenge.kind === 'scale')).toBe(true);
    const created = svc.createSession({ game_id: 'card-game', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    const chosen = svc.applyCommand(created.session_id, {
      command_id: 'scale-1', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });
    expect(chosen.state.pending_action.request).toMatchObject({ domain: 'piano', kind: 'scale' });
    expect(chosen.state.pending_action.request.prompt.expected_midi).toHaveLength(8);
  });

  it('pins the definition and replays commands authoritatively', () => {
    const svc = service();
    const created = svc.createSession({ game_id: 'scale-clash', participants: [{ user_id: 'guest' }], seed: 7 });
    const card = created.state.zones.hand[0];
    const response = svc.applyCommand(created.session_id, {
      command_id: 'command-1', session_revision: 0, type: 'choose_action', payload: { card_instance_id: card.instance_id },
    });
    expect(response.revision).toBe(1);
    expect(response.state.pending_action.status).toBe('requested');
    expect(response.definition_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('deduplicates a retry and rejects stale new commands', () => {
    const svc = service();
    const created = svc.createSession({ game_id: 'scale-clash', participants: [{ user_id: 'guest' }], seed: 7 });
    const command = {
      command_id: 'command-1', session_revision: 0, type: 'choose_action',
      payload: { card_instance_id: created.state.zones.hand[0].instance_id },
    };
    svc.applyCommand(created.session_id, command);
    expect(svc.applyCommand(created.session_id, command).duplicate).toBe(true);
    expect(() => svc.applyCommand(created.session_id, { ...command, command_id: 'command-2' })).toThrow(/stale/);
  });
});
