import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HomeAutomationSkill } from '../../../../../src/3_applications/brain/skills/HomeAutomationSkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeGateway {
  constructor() {
    this.calls = [];
    this.entities = [
      { entityId: 'light.office_main', state: 'off', attributes: { friendly_name: 'Office Light' } },
      { entityId: 'scene.movie_mode', state: 'scening', attributes: { friendly_name: 'Movie Mode' } },
      { entityId: 'script.bedtime_routine', state: 'idle', attributes: { friendly_name: 'Bedtime Routine' } },
    ];
  }
  async listAllStates() { return this.entities; }
  async getState(id) { return this.entities.find((e) => e.entityId === id) ?? null; }
  async getStates(ids) {
    const want = new Set(ids);
    return new Map(this.entities.filter((e) => want.has(e.entityId)).map((e) => [e.entityId, e]));
  }
  async callService(domain, service, data) {
    this.calls.push({ domain, service, data });
    return { ok: true, data };
  }
  async activateScene(id) {
    this.calls.push({ activateScene: id });
    return { ok: true };
  }
  async runScript(id) {
    this.calls.push({ runScript: id });
    return { ok: true };
  }
}

describe('HomeAutomationSkill', () => {
  it('toggles by friendly name via fuzzy match', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: silentLogger, config: { friendly_name_aliases: {} } });
    const toggle = skill.getTools().find((t) => t.name === 'ha_toggle_entity');
    const result = await toggle.execute({ name: 'office light', action: 'turn_on' }, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entity_id, 'light.office_main');
    assert.deepStrictEqual(gw.calls[0], {
      domain: 'light',
      service: 'turn_on',
      data: { entity_id: 'light.office_main' },
    });
  });

  it('returns ok:false on no match', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: silentLogger, config: {} });
    const toggle = skill.getTools().find((t) => t.name === 'ha_toggle_entity');
    const result = await toggle.execute({ name: 'wibble flarp', action: 'turn_on' }, {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'no_match');
  });

  it('activates scene by name (domain-restricted)', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: silentLogger, config: {} });
    const scene = skill.getTools().find((t) => t.name === 'ha_activate_scene');
    const result = await scene.execute({ name: 'movie mode' }, {});
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(gw.calls[0], { activateScene: 'scene.movie_mode' });
  });

  it('runs script by name', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: silentLogger, config: {} });
    const tool = skill.getTools().find((t) => t.name === 'ha_run_script');
    const result = await tool.execute({ name: 'bedtime routine' }, {});
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(gw.calls[0], { runScript: 'script.bedtime_routine' });
  });

  it('uses alias before fuzzy match', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({
      gateway: gw,
      logger: silentLogger,
      config: { friendly_name_aliases: { 'main light': 'light.office_main' } },
    });
    const toggle = skill.getTools().find((t) => t.name === 'ha_toggle_entity');
    const result = await toggle.execute({ name: 'main light', action: 'toggle' }, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.entity_id, 'light.office_main');
  });

  it('ha_get_state returns current state', async () => {
    const gw = new FakeGateway();
    const skill = new HomeAutomationSkill({ gateway: gw, logger: silentLogger, config: {} });
    const get = skill.getTools().find((t) => t.name === 'ha_get_state');
    const result = await get.execute({ name: 'office light' }, {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.state, 'off');
  });
});
