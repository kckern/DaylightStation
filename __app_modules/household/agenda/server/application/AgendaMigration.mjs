import { validateNamedGuest } from '../../../../../__capabilities/household-identity/server/public.mjs';
import { weekOf } from '../domain/calendar.mjs';
import { validatePlan, validateSeries } from '../domain/contracts.mjs';
import { migrationHash } from '../domain/migrationValues.mjs';
export { migrationHash, exportLegacyPlan } from '../domain/migrationValues.mjs';
const fail = (code, message) => {
  throw Object.assign(Error(message), {
    code
  });
};
const copy = value => JSON.parse(JSON.stringify(value));

/** Read-only planning, followed by an explicitly admitted installed-authority operation. */
export class AgendaMigration {
  constructor(deps) {
    Object.assign(this, deps);
    if (!this.store || !this.listCodec || !this.resolvePerson || !this.validateActivities) throw Error('Migration ports required');
  }
  async planConfigured({
    viewer
  } = {}) {
    const sourceSnapshot = this.store.captureSources();
    return this.planMigration({
      ...this.store.readInputs(sourceSnapshot),
      seriesId: this.seriesId,
      sourcePaths: this.store.sourcePaths,
      sourceSnapshot,
      viewer
    });
  }
  async planMigration({
    legacyList,
    gameDefaults,
    fitnessGuests,
    namedGuests,
    seriesId,
    targetWeek,
    sourcePaths,
    sourceSnapshot,
    viewer
  }) {
    const sources = sourceSnapshot ?? this.store.captureSources(sourcePaths);
    const currentWeek = weekOf({
      instant: this.clock(),
      timezone: this.timezone
    });
    if (targetWeek && targetWeek !== currentWeek) fail('invalid_week', 'Migration requires the explicitly selected current local week');
    targetWeek ??= currentWeek;
    this.listCodec.validateEmbeddedList(legacyList);
    const list = copy(this.listCodec.normalizeEmbeddedList(legacyList));
    list.sections.forEach((section, i) => {
      section.uid ??= `migration-section-${i}`;
    });
    const conflicts = [],
      changes = [],
      guests = copy(namedGuests.guests),
      fitness = copy(fitnessGuests),
      seen = new Set();
    for (const category of ['family', 'friends']) for (const entry of fitness.users?.[category] || []) {
      const id = entry.person?.id ?? entry.id;
      if (!id || seen.has(id)) {
        conflicts.push({
          kind: 'duplicate-fitness-identity',
          category,
          id: id ?? null
        });
        continue;
      }
      seen.add(id);
      const matches = guests.filter(g => g.id === id);
      if (matches.length > 1) {
        conflicts.push({
          kind: 'duplicate-directory-identity',
          id
        });
        continue;
      }
      const existing = matches[0];
      if (entry.person) {
        if (entry.person.kind !== 'guest' || !existing) conflicts.push({
          kind: 'unresolved-reference',
          id
        });
        continue;
      }
      const avatar = entry.avatar ?? existing?.avatar ?? {
        kind: 'user-avatar',
        userId: id
      };
      if (existing && (existing.name !== entry.name || entry.avatar && JSON.stringify(entry.avatar) !== JSON.stringify(existing.avatar))) {
        conflicts.push({
          kind: 'identity-definition-conflict',
          id,
          existing: copy(existing),
          inline: {
            name: entry.name,
            avatar
          }
        });
        continue;
      }
      const member = await this.resolvePerson({
        kind: 'user',
        id
      });
      if (member) {
        if (member.person?.kind !== 'user' || member.person.id !== id) fail('invalid_identity', 'Directory returned a mismatched identity');
        changes.push({
          kind: 'preserve-household-member-inline',
          id,
          category
        });
        continue;
      }
      if (!existing) {
        guests.push({
          id,
          name: entry.name,
          avatar,
          active: true
        });
        changes.push({
          kind: 'create-existing-fitness-guest',
          id
        });
      }
      delete entry.id;
      delete entry.name;
      delete entry.avatar;
      entry.person = {
        kind: 'guest',
        id
      };
      changes.push({
        kind: 'fitness-reference',
        id,
        category
      });
    }
    const uniqueGuests = new Set();
    for (const guest of guests) {
      if (uniqueGuests.has(guest.id)) conflicts.push({
        kind: 'duplicate-directory-identity',
        id: guest.id
      });
      uniqueGuests.add(guest.id);
    }
    const roster = gameDefaults.launch?.participants;
    if (!Array.isArray(roster)) fail('invalid_roster', 'Configured game roster required');
    const participants = [];
    for (const [i, runtimeId] of roster.entries()) {
      if (typeof runtimeId !== 'string') fail('invalid_roster', 'Unsupported configured participant');
      const person = runtimeId.startsWith('guest:') ? {
        kind: 'guest',
        id: runtimeId.slice(6)
      } : {
        kind: 'user',
        id: runtimeId
      };
      const guest = person.kind === 'guest' ? guests.find(g => g.id === person.id) : null;
      const resolved = guest ? {
        active: guest.active,
        display: {
          name: guest.name,
          avatar: guest.avatar ?? null
        }
      } : await this.resolvePerson(person);
      if (!resolved || resolved.active === false) fail('invalid_roster', 'Configured participant unavailable');
      participants.push({
        id: `roster-${i}`,
        person,
        display: copy(resolved.display)
      });
    }
    const modes = {};
    for (const [field, mode] of [['reader_participants', 'reader'], ['image_participants', 'image']]) for (const id of gameDefaults.presentation?.[field] || []) {
      const i = roster.indexOf(id);
      if (i < 0 || modes[`roster-${i}`]) fail('invalid_roster', 'Clue modes must uniquely address configured participants');
      modes[`roster-${i}`] = mode;
    }
    const activity_settings = {};
    const definitionId = this.definitionId ?? gameDefaults.artifact?.id ?? gameDefaults.id;
    for (const [index, item] of list.sections.flatMap(s => s.items).entries()) {
      item.uid ??= `migration-item-${migrationHash([seriesId, legacyList, index]).slice(0, 24)}`;
      if (item.open?.startsWith('party-games/') && definitionId && item.open !== `party-games/${definitionId}`) fail('invalid_target', 'Configured defaults do not belong to this Party Games target');
      if (item.open?.startsWith('party-games/')) activity_settings[item.uid] = {
        schema: 'agenda-activity-setup/v1',
        action: 'open',
        participants: {
          mode: 'plan'
        },
        consumer: {
          id: 'party-games',
          version: 1
        },
        settings: {
          schema: 'party-games-participant-setup/v1',
          autostart: gameDefaults.launch.autostart === true,
          charades: {
            default_clue_mode: 'text',
            clue_modes: copy(modes)
          }
        }
      };
    }
    const content = {
      list,
      participants,
      activity_settings
    };
    const series = {
      schema: 'agenda-series/v1',
      household_id: this.householdId,
      series_id: seriesId,
      revision: 0,
      title: list.title || seriesId,
      status: 'active',
      calendar: {
        frequency: 'weekly',
        timezone: this.timezone,
        week_starts_on: 'monday',
        default_day: 'monday'
      },
      defaults: copy(content)
    };
    const plan = {
      schema: 'agenda-plan/v1',
      household_id: this.householdId,
      series_id: seriesId,
      plan_id: `migration-${migrationHash([this.householdId, seriesId, targetWeek]).slice(0, 32)}`,
      revision: 0,
      title: series.title,
      week_of: targetWeek,
      scheduled_on: targetWeek,
      calendar: {
        timezone: this.timezone,
        week_starts_on: 'monday'
      },
      state: 'published',
      seeded_from: {
        kind: 'series',
        id: seriesId,
        revision: 0
      },
      ...copy(content)
    };
    const documents = {
      series,
      plan,
      namedGuests: {
        ...copy(namedGuests),
        revision: namedGuests.revision + (guests.length !== namedGuests.guests.length ? 1 : 0),
        guests
      },
      fitnessGuests: fitness
    };
    await this.validateDocuments(documents, viewer);
    const latest = this.store.captureSources(sourcePaths);
    if (Object.keys(latest).length !== Object.keys(sources).length || Object.keys(sources).some(key => latest[key]?.sha256 !== sources[key].sha256)) fail('source_changed', 'Sources changed during dry run');
    const preservedMembers = changes.filter(change => change.kind === 'preserve-household-member-inline').length;
    const warnings = conflicts.length ? ['Identity conflicts require explicit reconciliation and a new dry run'] : [];
    if (preservedMembers) warnings.push(`Preserve ${preservedMembers} exact canonical household member Fitness entries inline; only visitor identities move to named guests`);
    const manifest = {
      identityPolicy: {
        canonicalHouseholdMembers: 'preserve-fitness-inline',
        visitorIdentities: 'reconcile-named-guests'
      },
      schema: 'agenda-migration-review/v1',
      householdId: this.householdId,
      seriesId,
      targetWeek,
      documents,
      aliases: copy(this.aliases),
      identityChanges: {
        changes,
        conflicts
      },
      sources,
      sourceHashes: Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, value.sha256])),
      warnings
    };
    return {
      ...manifest,
      digest: migrationHash(manifest)
    };
  }
  async validateDocuments(documents, viewer) {
    const guests = documents.namedGuests;
    if (guests?.schema !== 'named-guests/v1' || !Number.isInteger(guests.revision) || guests.revision < 0 || !Array.isArray(guests.guests) || Object.keys(guests).some(key => !['schema', 'revision', 'guests'].includes(key))) fail('invalid_document', 'Invalid named guest directory');
    for (const guest of guests.guests) {
      if (Object.keys(guest).some(key => !['id', 'name', 'avatar', 'active'].includes(key))) fail('invalid_document', 'Unsupported guest identity fields');
      validateNamedGuest(guest);
    }
    for (const [key, validate] of [['series', validateSeries], ['plan', validatePlan]]) {
      const d = documents[key];
      this.repository.validateEmbeddedList(key === 'series' ? d.defaults.list : d.list);
      const encoded = this.repository.encodeDocument(d, key === 'series');
      const decoded = this.repository.decodeDocument(copy(encoded), key === 'series');
      const result = validate(decoded);
      if (!result.valid) fail('invalid_document', JSON.stringify(result.errors));
    }
    const result = await this.validateActivities({
      plan: documents.plan,
      viewer
    });
    if (!result.valid) fail('invalid_target', JSON.stringify(result.errors));
  }
  async applyMigration({
    reviewedManifest,
    expectedSourceHashes,
    viewer
  }) {
    this.verifyManifest(reviewedManifest);
    if (reviewedManifest.identityChanges.conflicts.length) fail('identity_conflict', 'Resolve identity conflicts before apply');
    const guestIds = reviewedManifest.documents.namedGuests.guests.map(guest => guest.id);
    if (new Set(guestIds).size !== guestIds.length) fail('identity_conflict', 'Duplicate named guest identities');
    if (JSON.stringify(expectedSourceHashes) !== JSON.stringify(reviewedManifest.sourceHashes)) fail('source_changed', 'Reviewed source hashes required');
    const completed = this.store.completedApply(reviewedManifest);
    if (completed) return completed;
    await this.validateDocuments(reviewedManifest.documents, viewer);
    return this.store.apply(reviewedManifest, {
      assertCurrent: () => {
        if (reviewedManifest.targetWeek !== weekOf({
          instant: this.clock(),
          timezone: this.timezone
        })) fail('invalid_week', 'Current week changed; review a new dry run');
      }
    });
  }
  verifyManifest(manifest) {
    const {
      digest,
      ...value
    } = manifest || {};
    if (value.schema !== 'agenda-migration-review/v1' || digest !== migrationHash(value) || value.householdId !== this.householdId || this.seriesId && value.seriesId !== this.seriesId || value.documents?.series?.series_id !== value.seriesId || value.documents?.plan?.series_id !== value.seriesId || value.documents?.plan?.week_of !== value.targetWeek || value.identityPolicy?.canonicalHouseholdMembers !== 'preserve-fitness-inline' || value.identityPolicy?.visitorIdentities !== 'reconcile-named-guests' || value.documents?.plan?.household_id !== this.householdId || value.documents?.series?.household_id !== this.householdId || JSON.stringify(value.aliases) !== JSON.stringify(this.aliases)) fail('invalid_manifest', 'Manifest identity or review digest mismatch');
  }
  async backoutMigration({
    reviewedManifest,
    planId,
    viewer
  }) {
    this.verifyManifest(reviewedManifest);
    return this.store.backout(reviewedManifest, planId, {
      viewer
    });
  }
}
