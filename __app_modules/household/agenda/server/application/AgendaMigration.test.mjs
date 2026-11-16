import { it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { AgendaMigration } from './AgendaMigration.mjs';
import { YamlAgendaRepository } from '../adapters/YamlAgendaRepository.mjs';
import { AgendaMigrationStore } from '../adapters/AgendaMigrationStore.mjs';
import { createMigrationOwnership } from '../adapters/MigrationOwnership.mjs';
import { EmbeddedListCodec } from '../../../../../__capabilities/content-catalog/server/list-codec.mjs';
import { YamlListDatastore } from '../../../../../__capabilities/content-catalog/server/adapters/persistence/YamlListDatastore.mjs';
import { YamlNamedGuestStore } from '../../../../../__capabilities/household-identity/server/adapters/YamlNamedGuestStore.mjs';
import { YamlAdminConfigStore } from '../../../../../__backend/src/1_adapters/persistence/yaml/YamlAdminConfigStore.mjs';
import { PeopleDirectory } from '../../../../../__capabilities/household-identity/server/public.mjs';
const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, {
  recursive: true,
  force: true
})));
it('returns an already completed apply receipt after later targets or source files change', async () => {
  const f = await fixture();
  const manifest = await f.plan();
  await f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  });
  f.migration.validateActivities = async () => {
    throw Error('target removed later');
  };
  writeFileSync(f.sourcePaths.gameDefaults, 'later source');
  expect((await f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  })).phase).toBe('complete');
});
it('rejects a different selected-plan payload after backout has completed', async () => {
  const f = await fixture();
  const manifest = await f.plan();
  await f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  });
  await f.migration.backoutMigration({
    reviewedManifest: manifest,
    planId: manifest.documents.plan.plan_id
  });
  await expect(f.migration.backoutMigration({
    reviewedManifest: manifest,
    planId: 'different'
  })).rejects.toMatchObject({
    code: 'idempotency_conflict'
  });
});
it('does not import one definition roster into a different Party Games target', async () => {
  const f = await fixture();
  f.sources.gameDefaults.id = 'charades:other';
  await expect(f.plan()).rejects.toMatchObject({
    code: 'invalid_target'
  });
});
async function fixture({
  checkpoint = () => {}
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'agenda-migration-'));
  dirs.push(dir);
  const sources = {
    legacyList: {
      title: 'Together',
      sections: [{
        uid: 'section',
        title: 'Start',
        items: [{
          uid: 'song',
          label: 'Sing',
          image: '/art/song.jpg',
          active: false,
          input: 'files:song',
          action: 'Play'
        }, {
          uid: 'game',
          title: 'Act',
          open: 'party-games/charades:family'
        }]
      }]
    },
    gameDefaults: {
      launch: {
        autostart: true,
        participants: ['member', 'guest:visitor']
      },
      presentation: {
        reader_participants: ['member'],
        image_participants: ['guest:visitor']
      }
    },
    namedGuests: {
      schema: 'named-guests/v1',
      revision: 1,
      guests: [{
        id: 'visitor',
        name: 'Visitor',
        avatar: {
          kind: 'user-avatar',
          userId: 'visitor'
        },
        active: true
      }]
    },
    fitnessGuests: {
      devices: {
        heart_rate: {
          '12': 'visitor'
        }
      },
      users: {
        primary: ['member'],
        family: [{
          id: 'visitor',
          name: 'Visitor',
          zones: {
            high: 140
          },
          birthyear: 1960
        }],
        friends: []
      }
    }
  };
  const sourcePaths = Object.fromEntries(Object.entries(sources).map(([k, v]) => {
    const file = path.join(dir, k === 'legacyList' ? 'content/lists/menus/family.yml' : k + '.yml');
    mkdirSync(path.dirname(file), {
      recursive: true
    });
    writeFileSync(file, yaml.dump(v));
    return [k, file];
  }));
  const aliases = [{
    kind: 'menu',
    id: 'family',
    owner: 'agenda',
    canonicalContentId: 'agenda:family',
    adminUrl: '/admin/content/agendas/family'
  }, {
    kind: 'menus',
    id: 'family',
    owner: 'agenda',
    canonicalContentId: 'agenda:family',
    adminUrl: '/admin/content/agendas/family'
  }];
  const manifestPath = path.join(dir, 'ownership.json');
  const ownership = createMigrationOwnership({
    manifestPath,
    aliases,
    householdId: 'home'
  });
  const repository = new YamlAgendaRepository({
    pathForHousehold: () => dir,
    listCodec: EmbeddedListCodec,
    assertWritable: args => ownership.assertAgendaWritable(args)
  });
  const store = new AgendaMigrationStore({
    manifestPath,
    sourcePaths,
    repository,
    ownership,
    checkpoint
  });
  const migration = new AgendaMigration({
    repository,
    store,
    listCodec: EmbeddedListCodec,
    householdId: 'home',
    seriesId: 'family',
    timezone: 'America/Los_Angeles',
    clock: () => new Date('2026-11-16T06:00:00Z'),
    aliases,
    resolvePerson: async person => person.kind === 'user' && person.id !== 'member' ? null : {
      person,
      display: {
        name: person.id === 'member' ? 'Member' : 'Visitor',
        avatar: null
      },
      active: true
    },
    validateActivities: async () => ({
      valid: true,
      errors: []
    })
  });
  const plan = () => migration.planMigration({
    ...sources,
    seriesId: 'family',
    sourcePaths
  });
  return {
    dir,
    migration,
    store,
    repository,
    ownership,
    sourcePaths,
    sources,
    plan
  };
}
it('plans one local week deterministically, preserving authored list, roster, modes and Fitness overlays without writing', async () => {
  const f = await fixture();
  const a = await f.plan();
  expect(await f.plan()).toEqual(a);
  expect(a.documents.plan.week_of).toBe('2026-11-09');
  expect(a.documents.plan.participants.map(p => p.person)).toEqual([{
    kind: 'user',
    id: 'member'
  }, {
    kind: 'guest',
    id: 'visitor'
  }]);
  expect(a.documents.plan.list.sections[0].items[0]).toMatchObject({
    uid: 'song',
    label: 'Sing',
    image: '/art/song.jpg',
    active: false,
    play: {
      contentId: 'files:song'
    }
  });
  expect(a.documents.plan.activity_settings.game.settings.charades.clue_modes).toEqual({
    'roster-0': 'reader',
    'roster-1': 'image'
  });
  expect(a.documents.fitnessGuests.users.family).toEqual([{
    person: {
      kind: 'guest',
      id: 'visitor'
    },
    zones: {
      high: 140
    },
    birthyear: 1960
  }]);
  expect(a.documents.fitnessGuests.devices).toEqual({
    heart_rate: {
      '12': 'visitor'
    }
  });
  expect(a.documents.namedGuests.guests).toHaveLength(1);
  expect(existsSync(path.join(f.dir, 'ownership.json'))).toBe(false);
});
it('rejects lossy fields, future weeks and ambiguous duplicate identities', async () => {
  const f = await fixture();
  f.sources.legacyList.sections[0].items[0].unknown = true;
  await expect(f.plan()).rejects.toMatchObject({
    code: 'invalid_document'
  });
  delete f.sources.legacyList.sections[0].items[0].unknown;
  await expect(f.migration.planMigration({
    ...f.sources,
    sourcePaths: f.sourcePaths,
    seriesId: 'family',
    targetWeek: '2026-11-16'
  })).rejects.toMatchObject({
    code: 'invalid_week'
  });
  f.sources.fitnessGuests.users.friends = [{
    id: 'visitor',
    name: 'Different'
  }];
  const plan = await f.plan();
  expect(plan.identityChanges.conflicts.length).toBeGreaterThan(0);
  await expect(f.migration.applyMigration({
    reviewedManifest: plan,
    expectedSourceHashes: plan.sourceHashes
  })).rejects.toMatchObject({
    code: 'identity_conflict'
  });
});
it('assigns deterministic IDs only to legacy rows without UIDs', async () => {
  const f = await fixture();
  delete f.sources.legacyList.sections[0].items[0].uid;
  const first = await f.plan(),
    second = await f.plan();
  const item = first.documents.plan.list.sections[0].items[0];
  expect(item.uid).toMatch(/^migration-item-/);
  expect(item.uid).toBe(second.documents.plan.list.sections[0].items[0].uid);
  expect(first.documents.plan.list.sections[0].items[1].uid).toBe('game');
});
it('refuses stale source bytes before any backup, journal, or output is written', async () => {
  const f = await fixture();
  const plan = await f.plan();
  writeFileSync(f.sourcePaths.legacyList, 'changed\n');
  await expect(f.migration.applyMigration({
    reviewedManifest: plan,
    expectedSourceHashes: plan.sourceHashes
  })).rejects.toMatchObject({
    code: 'source_changed'
  });
  expect(existsSync(path.join(f.dir, 'ownership.json'))).toBe(false);
  expect(existsSync(path.join(f.dir, 'agendas'))).toBe(false);
});
it.each(['prepared', 'named-guests-written', 'fitness-written', 'identities', 'installed', 'owned', 'retired', 'complete'])('recovers failure at %s with one authority and exact backups', async phase => {
  let failed = false;
  const f = await fixture({
    checkpoint: name => {
      if (name === phase && !failed) {
        failed = true;
        throw Error('injected');
      }
    }
  });
  const original = readFileSync(f.sourcePaths.legacyList);
  const plan = await f.plan();
  await expect(f.migration.applyMigration({
    reviewedManifest: plan,
    expectedSourceHashes: plan.sourceHashes
  })).rejects.toThrow('injected');
  const owned = ['owned', 'retired', 'complete'].includes(phase);
  expect(Boolean(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  }))).toBe(owned);
  const staged = await f.repository.readPlan({
    householdId: 'home',
    planId: plan.documents.plan.plan_id
  });
  if (staged && !owned) await expect(f.repository.mutatePlan({
    householdId: 'home',
    planId: staged.document.plan_id,
    expectedEtag: staged.etag,
    mutate: p => p
  })).rejects.toMatchObject({
    code: 'resource_moved'
  });
  await f.migration.applyMigration({
    reviewedManifest: plan,
    expectedSourceHashes: plan.sourceHashes
  });
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  }).owner).toBe('agenda');
  expect(existsSync(f.sourcePaths.legacyList)).toBe(false);
  expect(readFileSync(f.store.backupPath(plan, 'legacyList'))).toEqual(original);
  expect(await f.repository.listPlans({
    householdId: 'home',
    seriesId: 'family'
  })).toHaveLength(1);
});
it('exports the selected edited plan on backout and retains independent session journals', async () => {
  const f = await fixture();
  const plan = await f.plan();
  const journal = path.join(f.dir, 'direct-session.jsonl');
  writeFileSync(journal, '{"old":"journal"}\n');
  await f.migration.applyMigration({
    reviewedManifest: plan,
    expectedSourceHashes: plan.sourceHashes
  });
  const saved = await f.repository.readPlan({
    householdId: 'home',
    planId: plan.documents.plan.plan_id
  });
  await f.repository.mutatePlan({
    householdId: 'home',
    planId: saved.document.plan_id,
    expectedEtag: saved.etag,
    mutate: p => {
      p.list.sections[0].items[0].label = 'Edited';
      return p;
    }
  });
  await f.migration.backoutMigration({
    reviewedManifest: plan,
    planId: saved.document.plan_id
  });
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  })).toBeNull();
  expect(yaml.load(readFileSync(f.sourcePaths.legacyList, 'utf8')).sections[0].items[0].label).toBe('Edited');
  expect(readFileSync(journal, 'utf8')).toBe('{"old":"journal"}\n');
});
it('guards actual list, named identity and Admin config commits while migration holds the shared gate', async () => {
  let resume, entered;
  const waiting = new Promise(resolve => {
    entered = resolve;
  });
  const pause = new Promise(resolve => {
    resume = resolve;
  });
  const f = await fixture({
    checkpoint: async phase => {
      if (phase === 'prepared') {
        entered();
        await pause;
      }
    }
  });
  const plan = await f.plan();
  const applying = f.migration.applyMigration({
    reviewedManifest: plan,
    expectedSourceHashes: plan.sourceHashes
  });
  await waiting;
  const lists = new YamlListDatastore({
    dataDir: f.dir,
    listConfigCodec: EmbeddedListCodec,
    assertWritable: f.ownership.assertLegacyWritable
  });
  expect(() => lists.saveList('menus', 'family', 'home', {
    items: []
  })).toThrow();
  expect(() => lists.deleteList('menus', 'family', 'home')).toThrow();
  const guestStore = new YamlNamedGuestStore({
    pathForHousehold: () => f.sourcePaths.namedGuests,
    assertWritable: f.ownership.assertSharedWritable
  });
  expect(() => guestStore.write('home', 1, [])).toThrow();
  const config = new YamlAdminConfigStore({
    dataRoot: f.dir,
    assertWritable: f.ownership.assertSharedWritable
  });
  expect(() => config.writeHousehold({
    users: []
  })).toThrow();
  resume();
  await applying;
  expect(() => lists.createList('menus', 'family', 'home')).toThrow();
  lists.createList('menus', 'unrelated', 'home');
  expect(existsSync(path.join(f.dir, 'content/lists/menus/unrelated.yml'))).toBe(true);
});
it('waits for the installed series lane before admitting a migration', async () => {
  const f = await fixture();
  const manifest = await f.plan();
  let release, entered;
  const started = new Promise(resolve => {
    entered = resolve;
  });
  const hold = new Promise(resolve => {
    release = resolve;
  });
  const pending = f.repository.withSeriesLane(f.repository.laneKey('home', 'family'), async () => {
    entered();
    await hold;
  });
  await started;
  const applying = f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(existsSync(path.join(f.dir, 'ownership.json'))).toBe(false);
  release();
  await pending;
  await applying;
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  }).owner).toBe('agenda');
});
it('preserves a completed legacy store write and refuses stale retry under the same authority', async () => {
  const f = await fixture({
    checkpoint: phase => {
      if (phase === 'prepared') throw Error('pause');
    }
  });
  const manifest = await f.plan();
  await expect(f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  })).rejects.toThrow('pause');
  const lists = new YamlListDatastore({
    dataDir: f.dir,
    listConfigCodec: EmbeddedListCodec,
    assertWritable: f.ownership.assertLegacyWritable
  });
  const value = lists.getList('menus', 'family', 'home');
  value.title = 'Latest legacy write';
  lists.saveList('menus', 'family', 'home', value);
  await expect(f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  })).rejects.toMatchObject({
    code: 'source_changed'
  });
  expect(lists.getList('menus', 'family', 'home').title).toBe('Latest legacy write');
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  })).toBeNull();
});
it.each(['backout-prepared', 'backout-exported', 'backed-out'])('recovers backout failure at %s without reopening legacy early', async phase => {
  let failOnce = true;
  const f = await fixture({
    checkpoint: name => {
      if (name === phase && failOnce) {
        failOnce = false;
        throw Error('backout crash');
      }
    }
  });
  const manifest = await f.plan();
  await f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  });
  await expect(f.migration.backoutMigration({
    reviewedManifest: manifest,
    planId: manifest.documents.plan.plan_id
  })).rejects.toThrow('backout crash');
  expect(Boolean(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  }))).toBe(phase !== 'backed-out');
  await f.migration.backoutMigration({
    reviewedManifest: manifest,
    planId: manifest.documents.plan.plan_id
  });
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  })).toBeNull();
});
it.each(['anonymous','new-named-guest'])('refuses unsupported %s downgrade while keeping Agenda authoritative', async kind => {
  const f = await fixture();
  const manifest = await f.plan();
  await f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  });
  const saved = await f.repository.readPlan({
    householdId: 'home',
    planId: manifest.documents.plan.plan_id
  });
  await f.repository.mutatePlan({
    householdId: 'home',
    planId: saved.document.plan_id,
    expectedEtag: saved.etag,
    mutate: p => {
      p.participants.push({
        id: 'anonymous',
        ...(kind==='anonymous'?{anonymous:true}:{person:{kind:'guest',id:'new-visitor'}}),
        display: {
          name: 'Visitor',
          avatar: null
        }
      });
      return p;
    }
  });
  await expect(f.migration.backoutMigration({
    reviewedManifest: manifest,
    planId: saved.document.plan_id
  })).rejects.toMatchObject({
    code: 'unsupported_downgrade'
  });
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  }).owner).toBe('agenda');
});
it('aborts a failed pre-cutover migration without overwriting later legacy list edits', async () => {
  const f = await fixture({
    checkpoint: phase => {
      if (phase === 'installed') throw Error('stop before ownership');
    }
  });
  const manifest = await f.plan();
  const originalGuests = readFileSync(f.sourcePaths.namedGuests);
  await expect(f.migration.applyMigration({
    reviewedManifest: manifest,
    expectedSourceHashes: manifest.sourceHashes
  })).rejects.toThrow();
  writeFileSync(f.sourcePaths.legacyList, 'title: Later legacy edit\nitems: []\n');
  const result = await f.migration.backoutMigration({
    reviewedManifest: manifest,
    planId: manifest.documents.plan.plan_id
  });
  expect(result.phase).toBe('aborted');
  expect(readFileSync(f.sourcePaths.namedGuests)).toEqual(originalGuests);
  expect(readFileSync(f.sourcePaths.legacyList, 'utf8')).toContain('Later legacy edit');
  expect(f.ownership.aliases.resolve({
    kind: 'menu',
    id: 'family'
  })).toBeNull();
});
it('rejects source changes during asynchronous dry-run validation', async () => {
  const f = await fixture();
  f.migration.validateActivities = async () => {
    writeFileSync(f.sourcePaths.gameDefaults, 'launch: {participants: []}\n');
    return {
      valid: true,
      errors: []
    };
  };
  await expect(f.migration.planConfigured()).rejects.toMatchObject({
    code: 'source_changed'
  });
  expect(existsSync(path.join(f.dir, 'ownership.json'))).toBe(false);
});
it('preserves an exact canonical household member inline using the shared PeopleDirectory classification', async () => {
  const f = await fixture();
  const inline = {
    id: 'member',
    name: 'Fitness display',
    birthyear: 1970,
    zones: {
      high: 155
    }
  };
  f.sources.fitnessGuests.users.family.push(inline);
  const directory = new PeopleDirectory({
    householdDirectory: {
      userIds: () => ['member'],
      userProfile: () => ({
        display_name: 'Member'
      })
    },
    guestStore: new YamlNamedGuestStore({
      pathForHousehold: () => f.sourcePaths.namedGuests
    })
  });
  f.migration.resolvePerson = person => directory.resolve({
    householdId: 'home',
    person
  });
  const result = await f.plan();
  expect(result.identityChanges.conflicts).toEqual([]);
  expect(result.documents.fitnessGuests.users.family[1]).toEqual(inline);
  expect(result.documents.namedGuests.guests.map(g => g.id)).toEqual(['visitor']);
  expect(result.documents.plan.participants).toHaveLength(2);
  expect(result.identityPolicy.canonicalHouseholdMembers).toBe('preserve-fitness-inline');
  expect(result.warnings.some(w => w.includes('household member'))).toBe(true);
});
