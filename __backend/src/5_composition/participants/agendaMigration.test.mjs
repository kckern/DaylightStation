import { it, expect } from 'vitest';
import express from 'express';
import request from '../../../../tests/_lib/memory-http/request.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createConfiguredMigrationOwnership } from '../../../../__app_modules/household/agenda/server/composition.mjs';
import { installParticipantRuntime } from './installedRuntime.mjs';
import { PeopleDirectory } from '../../../../__capabilities/household-identity/server/public.mjs';
import { YamlNamedGuestStore } from '../../../../__capabilities/household-identity/server/adapters/index.mjs';
import { ConfigService } from '../../0_system/config/ConfigService.mjs';
import { FitnessConfigProjection } from '../../../../__app_modules/wellness/fitness/server/adapters/FitnessConfigProjection.mjs';
import { FitnessUserHydrator } from '../../../../__app_modules/wellness/fitness/server/application/services/FitnessUserHydrator.mjs';
import { runAgendaCli } from '../../../../__app_modules/household/agenda/cli/agenda.cli.mjs';
it('runs authenticated CLI dry-run, apply retry and selected backout through the installed server authority', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'installed-migration-'));
  const write = (relative, value) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), {
      recursive: true
    });
    writeFileSync(file, yaml.dump(value));
    return file;
  };
  try {
    write('system/config/system.yml', {
      timezone: 'UTC'
    });
    write('household/household.yml', {
      users: ['member']
    });
    write('users/member/profile.yml', {
      display_name: 'Member'
    });
    write('household/agendas/config.yml', {
      enabled: true,
      migration: {
        series_id: 'family',
        legacy_list_id: 'family',
        game_definition_id: 'charades:family'
      }
    });
    write('household/identity/named-guests.yml', {
      schema: 'named-guests/v1',
      revision: 0,
      guests: []
    });
    write('household/fitness/config.yml', {
      users: {
        primary: ['member'],
        family: [{
          id: 'visitor',
          name: 'Visitor',
          zones: {
            high: 140
          }
        }],
        friends: []
      }
    });
    write('content/lists/menus/family.yml', {
      title: 'Together',
      items: [{
        uid: 'game',
        open: 'party-games/charades:family'
      }, {
        uid: 'nav',
        list: {
          contentId: 'menu:songs'
        }
      }]
    });
    const definition = {
      experience: {
        id: 'charades',
        version: 1
      },
      rule_module: {
        id: 'activity-party',
        version: 1
      },
      competition: false,
      launch: {
        participants: ['member'],
        autostart: true
      },
      challenges: [{
        id: 'word',
        prompt: 'Run'
      }]
    };
    write('household/gaming/games/charades:family/rules.yml', definition);
    write('household/gaming/games/charades:family/content.yml', {
      challenges: definition.challenges
    });
    const manifest = {
      id: 'charades',
      version: 1,
      hash: 'd'.repeat(64),
      surfaces: [{
        id: 'party-games',
        authority_modes: ['remote']
      }]
    };
    write('household/gaming/manifests/charades.yml', manifest);
    const configService = new ConfigService({
      system: {
        dataDir: root,
        mediaDir: root,
        defaultHouseholdId: 'home',
        timezone: 'UTC'
      },
      households: {
        home: {
          _folderName: 'household',
          users: ['member'],
          apps: {
            agenda: yaml.load(readFileSync(path.join(root, 'household/agendas/config.yml'), 'utf8')),
            fitness: yaml.load(readFileSync(path.join(root, 'household/fitness/config.yml'), 'utf8'))
          }
        }
      }
    });
    const ownership = createConfiguredMigrationOwnership(configService);
    const directory = new PeopleDirectory({
      householdDirectory: {
        userIds: () => ['member'],
        userProfile: () => ({
          display_name: 'Member'
        })
      },
      guestStore: new YamlNamedGuestStore({
        pathForHousehold: () => path.join(root, 'household/identity/named-guests.yml'),
        assertWritable: ownership.assertSharedWritable
      })
    });
    const runtime = installParticipantRuntime({
      enabled: true,
      configService,
      ownership,
      resourceAliases: ownership.aliases,
      peopleDirectory: directory,
      contentRegistry: {
        register() {}
      },
      contentServices: {
        contentIdResolver: {
          resolve: value => value === 'menu:songs' ? {
            source: 'menu',
            localId: 'songs'
          } : null
        },
        contentCatalog: {
          getItem: async () => ({
            id: 'songs'
          }),
          capabilities: () => ['listable']
        }
      },
      gaming: {
        gamingApplication: {
          // The real GamingApplication declares the participant consumer for an
          // eligible casual Charades definition (participantEligibility.mjs); the
          // registry resolves the consumer only when the target carries it.
          getLaunchDescriptor: async () => ({
            definition_id: 'charades:family',
            surface: {
              id: 'party-games'
            },
            participantConsumer: {
              id: 'party-games',
              version: 1
            }
          })
        },
        definitions: {
          getCurrent: async () => ({
            definition,
            hash: 'a'.repeat(64),
            artifacts: {
              rules_definition: {
                id: 'charades:family',
                hash: 'b'.repeat(64)
              }
            }
          })
        },
        manifestStore: {
          get: () => manifest
        }
      },
      logger: {
        info() {},
        warn() {},
        error() {}
      },
      clock: () => new Date('2026-11-18T12:00:00Z')
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.get('Authorization') === 'Bearer test-token') req.user = {
        sub: 'operator',
        hid: 'home',
        roles: ['parent']
      };
      next();
    });
    app.use('/api/v1/admin/agenda-migration', runtime.agenda.migrationRouter);
    expect((await request(app).post('/api/v1/admin/agenda-migration/dry-run').send({})).status).toBe(401);
    const fetchImpl = async (url, options) => {
      const res = await request(app).post(new URL(url).pathname).set('Authorization', options.headers.Authorization).send(JSON.parse(options.body));
      return {
        ok: res.status < 300,
        status: res.status,
        json: async () => res.body
      };
    };
    const deps = {
      fetchImpl,
      env: {
        DAYLIGHT_AGENDA_TOKEN: 'test-token'
      },
      stdout: {
        write() {}
      }
    };
    const output = path.join(root, 'review.json');
    const review = await runAgendaCli(['migration', 'dry-run', '--server', 'http://installed.invalid', '--output', output], deps);
    expect(review.documents.plan.participants).toHaveLength(1);
    expect(review.documents.plan.list.sections[0].items[1].list).toEqual({
      contentId: 'menu:songs'
    });
    const args = ['--server', 'http://installed.invalid', '--manifest', output, '--review-digest', review.digest];
    const originalProfile = readFileSync(path.join(root, 'users/member/profile.yml'));
    writeFileSync(path.join(root, 'users/member/profile.yml'), 'display_name: Changed\n');
    await expect(runAgendaCli(['migration', 'apply', ...args], deps)).rejects.toMatchObject({
      code: 'source_changed'
    });
    expect(existsSync(ownership.configuration.manifestPath)).toBe(false);
    writeFileSync(path.join(root, 'users/member/profile.yml'), originalProfile);
    runtime.agenda.migration.store.checkpoint = phase => {
      if (phase === 'installed') throw Error('lost response before ownership');
    };
    await expect(runAgendaCli(['migration', 'apply', ...args], deps)).rejects.toMatchObject({
      code: 'internal_error'
    });
    await expect(runtime.agenda.contentAdapter.getList('family', {
      viewer: {
        participant_id: 'operator',
        householdId: 'home',
        role: 'host'
      },
      participantLaunchVersion: 1
    })).rejects.toMatchObject({
      code: 'resource_moved'
    });
    runtime.agenda.migration.store.checkpoint = () => {};
    expect((await runAgendaCli(['migration', 'apply', ...args], deps)).phase).toBe('complete');
    expect((await runAgendaCli(['migration', 'apply', ...args], deps)).phase).toBe('complete');
    expect(ownership.aliases.resolve({
      kind: 'menu',
      id: 'family'
    }).canonicalContentId).toBe('agenda:family');
    expect(ownership.aliases.resolve({
      kind: 'menu',
      id: 'other'
    })).toBeNull();
    const projection = new FitnessConfigProjection({
      configService,
      logger: {}
    });
    const hydrator = new FitnessUserHydrator({
      profileReader: {
        getProfile: () => ({
          username: 'member'
        })
      },
      guestResolver: id => directory.resolve({
        householdId: 'home',
        person: {
          kind: 'guest',
          id
        }
      })
    });
    expect(projection.raw('home').users.family[0].person.kind).toBe('guest');
    const guestStore = new YamlNamedGuestStore({
      pathForHousehold: () => path.join(root, 'household/identity/named-guests.yml'),
      assertWritable: ownership.assertSharedWritable
    });
    const guestDoc = guestStore.read('home');
    guestStore.write('home', guestDoc.revision, guestDoc.guests.map(g => ({
      ...g,
      name: 'Changed after apply'
    })));
    expect(hydrator.hydrateConfig(projection.raw('home')).users.family[0].name).toBe('Changed after apply');
    const backoutFile = path.join(root, 'backout-review.json');
    const preview = await runAgendaCli(['migration', 'backout-preview', ...args, '--plan-id', review.documents.plan.plan_id, '--output', backoutFile], deps);
    expect(preview.revision).toBe(review.documents.plan.revision);
    await expect(runAgendaCli(['migration', 'backout', ...args, '--plan-id', review.documents.plan.plan_id, '--backout-review', backoutFile, '--backout-digest', review.digest], deps)).rejects.toMatchObject({
      code: 'invalid_manifest'
    });
    expect(ownership.read().phase).toBe('complete');
    await expect(runAgendaCli(['migration', 'backout', ...args, '--plan-id', review.documents.plan.plan_id], deps)).rejects.toThrow('Reviewed backout preview');
    expect((await runAgendaCli(['migration', 'backout', ...args, '--plan-id', review.documents.plan.plan_id, '--backout-review', backoutFile, '--backout-digest', preview.digest], deps)).phase).toBe('backed-out');
    expect(ownership.aliases.resolve({
      kind: 'menu',
      id: 'family'
    })).toBeNull();
    expect(existsSync(path.join(root, 'content/lists/menus/family.yml'))).toBe(true);
    // Persisted ownership reaches backed-out, a retry is idempotent, and the
    // legacy list is a normal list again with its game and navigation items.
    expect(ownership.read().phase).toBe('backed-out');
    expect((await runAgendaCli(['migration', 'backout', ...args, '--plan-id', review.documents.plan.plan_id, '--backout-review', backoutFile, '--backout-digest', preview.digest], deps)).phase).toBe('backed-out');
    const restored = yaml.load(readFileSync(path.join(root, 'content/lists/menus/family.yml'), 'utf8'));
    expect(restored.title).toBe('Together');
    expect(restored.sections.flatMap(section => section.items).map(({uid, input, action}) => ({uid, input, action}))).toEqual([
      {uid: 'game', input: 'app:party-games/charades:family', action: 'Open'},
      {uid: 'nav', input: 'menu:songs', action: 'List'}
    ]);
    writeFileSync(ownership.configuration.manifestPath, '{}');
    expect(() => ownership.aliases.resolve({
      kind: 'menu',
      id: 'family'
    })).toThrow();
  } finally {
    rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
