// cli/exerciseLibraryIndex.lib.mjs
//
// Pure index builder for the shared exercise-reference corpus.
//
// WHY THIS EXISTS
// ---------------
// The corpus (~1,287 exercises + muscle/group/equipment taxonomies, each a tiny
// YAML file) lives on a cloud-synced tree whose files are online-only placeholders.
// Hydrating a single 1.8 KB YAML measured >120s cold. Nothing may ever walk that
// tree at request time. This module walks it ONCE, offline, and emits a single
// manifest that a backend adapter later reads whole.
//
// CONTRACTS
// ---------
// - Never throws on bad data. A defective corpus still yields a usable index;
//   every unresolvable reference is returned as DATA in `warnings`.
// - Pure with respect to time: `builtAt` is injected, never read from a clock.
// - Deterministic: inputs are sorted, so two runs over an unchanged corpus
//   produce a byte-identical manifest.
// - Output is camelCase only; downstream layers never see the corpus snake_case.

import path from 'path';
import {
  dirExists,
  listYamlFiles,
  listFiles,
  loadYamlSafe,
} from '#system/utils/FileIO.mjs';

/** Manifest schema version. Bump when the output shape changes. */
export const SCHEMA_VERSION = 1;

const COLLECTIONS = {
  muscleGroups: 'muscle_groups',
  muscles: 'muscles',
  equipment: 'equipment',
  exercises: 'exercises',
};

// Exercise demos are animated GIFs; muscle plates are PNGs. Verified by counts in
// the live corpus (1285 .gif ≈ one per exercise, 24 .png = one per muscle record).
// Used only as the fallback when the assets directory is absent or unlisted — when
// it IS present the real filename wins.
const DEFAULT_EXT = { exercise: '.gif', muscle: '.png' };

/**
 * Collects warnings, deduplicated by (kind, identifier, referrer).
 *
 * Deduplication is deliberate. In the live corpus a single defect — e.g. the
 * missing `muscle_groups/core.yaml` — is referenced by hundreds of exercises.
 * Appending one entry per reference would bloat the manifest with noise that
 * says nothing the first entry didn't. Instead each distinct defect appears
 * once, carrying an example referrer and a `count` of how many records hit it.
 */
function createWarningSink() {
  const byKey = new Map();
  const list = [];

  return {
    list,
    add(kind, identifierField, identifier, referrer, referencedBy) {
      const key = `${kind}::${identifier}::${referrer}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      const warning = {
        kind,
        [identifierField]: identifier,
        referrer,        // which collection held the dangling reference
        referencedBy,    // slug of the first record that referenced it
        count: 1,
      };
      byKey.set(key, warning);
      list.push(warning);
    },
    addPlain(warning) {
      list.push(warning);
    },
  };
}

/**
 * Read one collection directory into a slug-keyed map of raw records.
 * Missing directories are tolerated: empty map plus a warning.
 *
 * Only YAML entries are read. The corpus interleaves sibling images in these
 * same directories (`3-4-sit-up.yaml`, `3-4-sit-up_1.png`, `muscles/abs.png`),
 * so a naive file listing would try to parse PNGs.
 */
function readCollection(corpusDir, dirName, warnings) {
  const dirPath = path.join(corpusDir, dirName);
  const records = new Map();

  if (!dirExists(dirPath)) {
    warnings.addPlain({ kind: 'missing-directory', directory: dirName });
    return records;
  }

  for (const base of listYamlFiles(dirPath).sort()) {
    const record = loadYamlSafe(path.join(dirPath, base));
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      warnings.addPlain({ kind: 'unreadable-record', directory: dirName, file: base });
      continue;
    }
    // The filename is the authority on identity; `slug` inside the record is a
    // cross-check. They agree throughout the live corpus, but if one drifted the
    // path is what every other record's references are written against.
    const slug = base;
    if (record.slug && record.slug !== slug) {
      warnings.addPlain({
        kind: 'slug-mismatch', directory: dirName, file: base, declaredSlug: record.slug,
      });
    }
    records.set(slug, record);
  }

  return records;
}

/**
 * Index the assets directory by uuid in a SINGLE directory read.
 *
 * Per-file existence probes would be 1,287+ stats against a cloud-synced mount;
 * one listing answers every lookup. Returns null when there is no assets dir,
 * which switches image resolution to the extension defaults.
 */
function readAssetIndex(corpusDir) {
  const assetsDir = path.join(corpusDir, 'assets');
  if (!dirExists(assetsDir)) return null;

  const byId = new Map();
  for (const filename of listFiles(assetsDir)) {
    const ext = path.extname(filename);
    if (!ext) continue;
    byId.set(path.basename(filename, ext), filename);
  }
  return byId;
}

/**
 * Turn an image uuid into a corpus-relative asset path.
 * @returns {string|null} e.g. 'assets/<uuid>.gif', or null when the record has no image.
 */
function resolveAsset(imageId, assetIndex, kindHint, ownerSlug, warnings) {
  if (!imageId) return null;

  if (assetIndex) {
    const filename = assetIndex.get(imageId);
    if (filename) return `assets/${filename}`;
    warnings.add('missing-asset', 'asset', imageId, kindHint, ownerSlug);
  }

  return `assets/${imageId}${DEFAULT_EXT[kindHint]}`;
}

/** Coerce a YAML scalar-or-sequence field into a clean array of strings. */
function toStringArray(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter((v) => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/** Append `exerciseSlug` to `map[key]`, creating the bucket on first use. */
function addToBucket(map, key, exerciseSlug) {
  if (!map[key]) map[key] = [];
  if (!map[key].includes(exerciseSlug)) map[key].push(exerciseSlug);
}

/**
 * Build the exercise-library index from a corpus directory.
 *
 * @param {string} corpusDir Root holding exercises/, muscles/, muscle_groups/,
 *   equipment/ and (optionally) assets/.
 * @param {Object} [options]
 * @param {string|null} [options.builtAt] Caller-supplied build timestamp. Injected
 *   rather than read from a clock so the builder stays pure and testable.
 * @returns {{
 *   exercises: Object, muscles: Object, muscleGroups: Object, equipment: Object,
 *   byGroup: Object, byMuscle: Object, byEquipment: Object,
 *   warnings: Object[], builtAt: string|null, version: number
 * }}
 */
export function buildExerciseIndex(corpusDir, { builtAt = null } = {}) {
  const warnings = createWarningSink();

  const rawGroups = readCollection(corpusDir, COLLECTIONS.muscleGroups, warnings);
  const rawMuscles = readCollection(corpusDir, COLLECTIONS.muscles, warnings);
  const rawEquipment = readCollection(corpusDir, COLLECTIONS.equipment, warnings);
  const rawExercises = readCollection(corpusDir, COLLECTIONS.exercises, warnings);
  const assetIndex = readAssetIndex(corpusDir);

  // --- muscle groups -------------------------------------------------------
  const muscleGroups = {};
  for (const [slug, record] of rawGroups) {
    muscleGroups[slug] = {
      id: record.id ?? null,
      slug,
      name: record.name ?? slug,
      description: record.description ?? null,
      muscles: toStringArray(record.muscles),
    };
  }

  // --- muscles -------------------------------------------------------------
  // A muscle's `group` is the ONLY authority on which group an exercise belongs
  // to, so an unresolvable group here is a real defect and is warned about at
  // this point — independent of whether any exercise happens to target it.
  const muscles = {};
  const muscleGroupOf = new Map();
  for (const [slug, record] of rawMuscles) {
    const declaredGroup = typeof record.group === 'string' ? record.group.trim() : null;
    const groupExists = declaredGroup !== null && Object.hasOwn(muscleGroups, declaredGroup);

    if (declaredGroup && !groupExists) {
      warnings.add('unknown-group', 'group', declaredGroup, 'muscle', slug);
    }
    if (groupExists) muscleGroupOf.set(slug, declaredGroup);

    muscles[slug] = {
      id: record.id ?? null,
      slug,
      name: record.name ?? slug,
      group: groupExists ? declaredGroup : null,
      declaredGroup,
      description: record.description ?? null,
      fullDescription: record.full_description ?? null,
      imageId: record.image ?? null,
      image: resolveAsset(record.image, assetIndex, 'muscle', slug, warnings),
    };
  }

  // A group may also list muscles that have no record of their own.
  for (const [slug, group] of Object.entries(muscleGroups)) {
    for (const muscleSlug of group.muscles) {
      if (!Object.hasOwn(muscles, muscleSlug)) {
        warnings.add('unknown-muscle', 'muscle', muscleSlug, 'muscle-group', slug);
      }
    }
  }

  // --- equipment -----------------------------------------------------------
  const equipment = {};
  for (const [slug, record] of rawEquipment) {
    equipment[slug] = {
      id: record.id ?? slug,
      slug,
      name: record.name ?? slug,
      description: record.description ?? null,
    };
  }

  // --- exercises + inverted indexes ---------------------------------------
  const exercises = {};
  const byGroup = {};
  const byMuscle = {};
  const byEquipment = {};

  for (const [slug, record] of rawExercises) {
    const targetMuscles = toStringArray(record.target_muscles);
    const targetGroups = toStringArray(record.target_groups);
    const equipmentSlugs = toStringArray(record.equipment);

    // Group membership is DERIVED: exercise -> muscle record -> that muscle's
    // group. The exercise's own `target_groups` is a hint only and never decides
    // membership; it is preserved verbatim so a later audit can diff hint vs.
    // derived, and validated only to surface dangling references.
    const derivedGroups = [];
    for (const muscleSlug of targetMuscles) {
      if (!Object.hasOwn(muscles, muscleSlug)) {
        warnings.add('unknown-muscle', 'muscle', muscleSlug, 'exercise', slug);
        continue;
      }
      addToBucket(byMuscle, muscleSlug, slug);

      const group = muscleGroupOf.get(muscleSlug);
      if (group && !derivedGroups.includes(group)) derivedGroups.push(group);
    }
    for (const group of derivedGroups) addToBucket(byGroup, group, slug);

    for (const hinted of targetGroups) {
      if (!Object.hasOwn(muscleGroups, hinted)) {
        warnings.add('unknown-group', 'group', hinted, 'exercise', slug);
      }
    }

    for (const equipmentSlug of equipmentSlugs) {
      if (!Object.hasOwn(equipment, equipmentSlug)) {
        warnings.add('unknown-equipment', 'equipment', equipmentSlug, 'exercise', slug);
        continue;
      }
      addToBucket(byEquipment, equipmentSlug, slug);
    }

    exercises[slug] = {
      id: record.id ?? null,
      slug,
      name: record.name ?? slug,
      description: record.description ?? null,
      instructions: toStringArray(record.instructions),
      imageId: record.image ?? null,
      gif: resolveAsset(record.image, assetIndex, 'exercise', slug, warnings),
      targetMuscles,
      targetGroups,
      groups: derivedGroups,
      equipment: equipmentSlugs,
    };
  }

  // Stable ordering keeps the emitted manifest byte-identical across rebuilds.
  for (const bucket of [byGroup, byMuscle, byEquipment]) {
    for (const key of Object.keys(bucket)) bucket[key].sort();
  }

  return {
    exercises,
    muscles,
    muscleGroups,
    equipment,
    byGroup,
    byMuscle,
    byEquipment,
    warnings: warnings.list,
    builtAt,
    version: SCHEMA_VERSION,
  };
}
