import path from 'node:path';
import { readTextFromPath, resolveRealPath } from '#system/utils/FileIO.mjs';
import yaml from 'js-yaml';
import { createMigrationOwnership } from './MigrationOwnership.mjs';
const safe = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,100}$/.test(value) || value === '..') throw Error('Invalid migration configuration');
  return value;
};
/** Resolve physical paths through owner configuration; HTTP manifests cannot choose destinations. */
export function createConfiguredMigrationOwnership(configService) {
  const householdId = configService.getDefaultHouseholdId();
  const migration = configService.getHouseholdAppConfig(householdId, 'agenda')?.migration;
  if (!migration) return createMigrationOwnership({
    householdId
  });
  if (Object.keys(migration).some(k => !['series_id', 'legacy_list_id', 'game_definition_id'].includes(k))) throw Error('Unknown migration configuration');
  const seriesId = safe(migration.series_id),
    listId = safe(migration.legacy_list_id),
    definitionId = safe(migration.game_definition_id);
  const household = relative => configService.getHouseholdPath(relative, householdId);
  const aliases = ['menu', 'menus'].map(kind => ({
    kind,
    id: listId,
    owner: 'agenda',
    canonicalContentId: `agenda:${seriesId}`,
    adminUrl: `/admin/content/agendas/${seriesId}`
  }));
  const manifestPath = household(`agendas/migrations/${seriesId}.json`);
  const sourcePaths = {
    legacyList: path.join(configService.getDataDir(), 'content', 'lists', 'menus', `${listId}.yml`),
    gameDefaults: household(`gaming/games/${definitionId}/rules.yml`),
    namedGuests: household('identity/named-guests.yml'),
    fitnessGuests: configService.getHouseholdAppConfigPath(householdId, 'fitness'),
    household: household('household.yml'),
    agendaConfig: configService.getHouseholdAppConfigPath(householdId, 'agenda')
  };
  const baseKeys = new Set(Object.keys(sourcePaths));
  const inventory = () => {
    for (const key of Object.keys(sourcePaths)) if (!baseKeys.has(key)) delete sourcePaths[key];
    const read = file => yaml.load(readTextFromPath(file));
    sourcePaths.system = path.join(configService.getDataDir(), 'system/config/system.yml');
    for (const id of read(sourcePaths.household).users || []) sourcePaths[`profile-${safe(id)}`] = path.join(configService.getUserDir(id), 'profile.yml');
    const rules = read(sourcePaths.gameDefaults);
    sourcePaths.gameContent = household(`gaming/games/${definitionId}/content.yml`);
    sourcePaths.gameManifest = household(`gaming/manifests/${safe(rules.experience.id)}.yml`);
    const content = read(sourcePaths.gameContent);
    if (content.clue_bank) {
      const root = resolveRealPath(path.join(configService.getDataDir(), 'content/games'));
      const contained = (base, relative) => {
        const file = resolveRealPath(path.resolve(base, relative));
        if (!file.startsWith(root + path.sep)) throw Error('Clue source escapes configured content root');
        return file;
      };
      sourcePaths.clueBank = contained(root, content.clue_bank);
      for (const [i, clue] of (read(sourcePaths.clueBank).clues || []).entries()) if (clue.image) sourcePaths[`clueImage-${i}`] = contained(path.dirname(sourcePaths.clueBank), clue.image);
    }
    return sourcePaths;
  };
  const ownership = createMigrationOwnership({
    manifestPath,
    aliases,
    householdId
  });
  ownership.configuration = {
    householdId,
    seriesId,
    definitionId,
    manifestPath,
    sourcePaths,
    aliases,
    inventory
  };
  ownership.assertFileWritable = file => {
    const resolved = path.resolve(file);
    if (resolved.startsWith(path.resolve(household('agendas')) + path.sep)) throw Object.assign(Error('Use Agenda owner commands'), {
      code: 'resource_moved'
    });
    if (resolved === sourcePaths.legacyList) ownership.assertLegacyWritable({
      kind: 'menu',
      id: listId
    });
    if (Object.values(sourcePaths).includes(resolved)) ownership.assertSharedWritable();
  };
  return ownership;
}
