import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadConfig} from './configLoader.mjs';
import {ConfigService} from './ConfigService.mjs';

it('loads and reloads opt-in Agenda config from the colocated owner path', () => {
 const root=mkdtempSync(path.join(tmpdir(),'agenda-config-'));
 try {
  const household=path.join(root,'household');mkdirSync(household,{recursive:true});writeFileSync(path.join(household,'household.yml'),'name: Home\n');
  const legacy=path.join(household,'apps');mkdirSync(legacy);writeFileSync(path.join(legacy,'agenda.yml'),'enabled: true\n');
  const absent=loadConfig(root);const id=Object.keys(absent.households)[0];const before=new ConfigService(absent);
  expect(before.getHouseholdAppConfig(id,'agenda')).toBeNull();
  const folder=path.join(household,'agendas');mkdirSync(folder);const file=path.join(folder,'config.yml');writeFileSync(file,'enabled: true\n');
  const service=new ConfigService(loadConfig(root));
  expect(service.getHouseholdAppConfig(id,'agenda')).toEqual({enabled:true});
  expect(service.getHouseholdAppConfigPath(id,'agenda')).toBe(file);
  writeFileSync(file,'enabled: false\n');expect(service.reloadHouseholdAppConfig(id,'agenda')).toEqual({enabled:false});
  expect(service.getHouseholdAppConfig(id,'agenda')).toEqual({enabled:false});
 } finally {rmSync(root,{recursive:true,force:true});}
});
