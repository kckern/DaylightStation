import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadConfig} from './configLoader.mjs';
import {ConfigService} from './ConfigService.mjs';

it('reads household/triage/config.yml as the triage app config', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'triage-config-'));
  try {
    const household = path.join(root, 'household'); mkdirSync(household, { recursive: true });
    writeFileSync(path.join(household, 'household.yml'), 'name: Home\n');
    const id = Object.keys(loadConfig(root).households)[0];
    expect(new ConfigService(loadConfig(root)).getHouseholdAppConfig(id, 'triage')).toBeNull();
    mkdirSync(path.join(household, 'triage'));
    writeFileSync(path.join(household, 'triage', 'config.yml'), 'users:\n  sample:\n    enrolled: true\n');
    expect(new ConfigService(loadConfig(root)).getHouseholdAppConfig(id, 'triage')).toEqual({ users: { sample: { enrolled: true } } });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
