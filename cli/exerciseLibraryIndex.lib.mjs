// cli/exerciseLibraryIndex.lib.mjs
//
// Pure index builder for the shared exercise-reference corpus.
//
// WHY THIS EXISTS
// ---------------
// The corpus (~1,296 exercises + muscle/group/equipment taxonomies, each a tiny
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
// - Deterministic: every directory listing is sorted, so two runs over an
//   unchanged corpus produce a byte-identical manifest.
// - Output is camelCase only; downstream layers never see the corpus snake_case.
// - Every map keyed by a corpus slug has a NULL PROTOTYPE. Slugs are untrusted
//   input, and the corpus is free to contain `constructor` or `__proto__`.

import path from 'path';
import {
  dirExists,
  listEntries,
  loadYamlSafe,
} from '#system/utils/FileIO.mjs';

/** Manifest schema version. Bump when the output shape changes. */
export const SCHEMA_VERSION = 1;

/** Directory name -> the referrer label used in warnings for records read from it. */
const COLLECTIONS = {
  muscleGroups: { dir: 'muscle_groups', referrer: 'muscle-group' },
  muscles: { dir: 'muscles', referrer: 'muscle' },
  equipment: { dir: 'equipment', referrer: 'equipment' },
  exercises: { dir: 'exercises', referrer: 'exercise' },
};

const ASSETS_DIR = 'assets';
const VIDEO_DIR = 'hevy_videos';

// Exercise demos are animated GIFs; muscle plates are PNGs. Verified against the
// live corpus by filename census: 1285 .gif (≈ one per exercise) and 24 .png
// (exactly one per muscle record). Used to disambiguate when one uuid has files
// under several extensions, and as the shape of the guess when assets/ is absent.
const PREFERRED_EXT = { exercise: '.gif', muscle: '.png' };

const YAML_RE = /\.ya?ml$/i;
const STILL_RE = /^(.+)_(\d+)\.png$/i;
const VIDEO_RE = /\.mp4$/i;

/**
 * Warning collector. Every warning is the SAME five-key skeleton, in the same
 * key order, so consumers (notably Task 3's `validate`) can render any warning
 * without a per-kind branch:
 *
 *   { kind, subject, referrer, referencedBy, count }
 *
 * - `subject`      the offending identifier (a slug, uuid, filename or field name)
 * - `referrer`     which kind of record held the bad reference, or null
 * - `referencedBy` slug of the FIRST record that referenced it, or null
 * - `count`        how many DISTINCT records hit this same defect
 *
 * Warnings are deduplicated by (kind, subject, referrer). In the live corpus one
 * defect — the missing `muscle_groups/core.yaml` — is referenced by hundreds of
 * exercises; one entry per reference would bury the manifest in noise that says
 * nothing the first entry didn't. `count` tracks distinct referencing records, so
 * a record naming `core` twice still counts once.
 */
function createWarningSink() {
  const list = [];
  const byKey = new Map();

  return {
    list,
    add(kind, subject, referrer = null, referencedBy = null) {
      const key = `${kind}::${subject}::${referrer}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.refs.add(referencedBy);
        existing.warning.count = existing.refs.size;
        return;
      }
      const warning = { kind, subject, referrer, referencedBy, count: 1 };
      byKey.set(key, { warning, refs: new Set([referencedBy]) });
      list.push(warning);
    },
  };
}

/**
 * One sorted, stat-free directory listing.
 *
 * Deliberately `listEntries` (a bare readdirSync) rather than `listFiles`, which
 * stats every entry — measured at ~385 ms for the 1,321-entry assets directory on
 * the cloud mount. We only ever need names. Non-file entries would be misread as
 * files, which is acceptable: none of these directories contain subdirectories.
 */
function sortedEntries(dirPath) {
  return listEntries(dirPath)
    .filter((name) => !name.startsWith('.'))
    .sort();
}

/** Coerce a YAML scalar to a trimmed string, warning if it is a mapping/sequence. */
function toStringOrNull(value, field, referrer, slug, warnings) {
  if (value == null) return null;
  if (typeof value === 'object') {
    warnings.add('non-scalar-field', field, referrer, slug);
    return null;
  }
  const str = String(value).trim();
  return str === '' ? null : str;
}

/**
 * Coerce a YAML scalar-or-sequence field into a clean array of strings.
 * Warns when a value was present but yielded nothing — an explicit empty
 * sequence is legitimate and passes without comment.
 */
function toStringArray(value, field, referrer, slug, warnings) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  const out = arr
    .filter((v) => v != null && typeof v !== 'object')
    .map((v) => String(v).trim())
    .filter((v) => v !== '');
  if (out.length === 0 && !(Array.isArray(value) && value.length === 0)) {
    warnings.add('empty-field', field, referrer, slug);
  }
  return out;
}

/**
 * Read one collection directory into a slug-keyed Map of raw records, plus the
 * directory's non-YAML entries (the corpus interleaves images with records:
 * `3-4-sit-up.yaml`, `3-4-sit-up_1.png`, `muscles/abs.png`).
 *
 * Missing directories are tolerated: empty result plus a warning.
 */
function readCollection(corpusDir, { dir, referrer }, warnings) {
  const dirPath = path.join(corpusDir, dir);
  const records = new Map();
  const otherFiles = [];

  if (!dirExists(dirPath)) {
    warnings.add('missing-directory', dir);
    return { records, otherFiles };
  }

  for (const filename of sortedEntries(dirPath)) {
    if (!YAML_RE.test(filename)) {
      otherFiles.push(filename);
      continue;
    }

    // The filename is the authority on identity — every cross-reference in the
    // corpus is written against paths, not against the record's own `slug`.
    const slug = filename.replace(YAML_RE, '');

    // `dup.yaml` and `dup.yml` collapse to the same slug. Sorted order makes the
    // winner stable (.yaml before .yml); the loser is reported, never dropped
    // silently.
    if (records.has(slug)) {
      warnings.add('duplicate-record', slug, referrer, filename);
      continue;
    }

    const record = loadYamlSafe(path.join(dirPath, filename));
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      warnings.add('unreadable-record', filename, referrer);
      continue;
    }
    if (record.slug && record.slug !== slug) {
      warnings.add('slug-mismatch', String(record.slug), referrer, slug);
    }
    records.set(slug, record);
  }

  return { records, otherFiles };
}

/**
 * Index the assets directory by uuid in a SINGLE sorted directory read.
 *
 * @returns {Map<string,string[]>|null} uuid -> sorted filenames, or null when
 *   there is no assets directory (which downgrades every image path to a guess).
 */
function readAssetIndex(corpusDir, warnings) {
  const dirPath = path.join(corpusDir, ASSETS_DIR);
  if (!dirExists(dirPath)) {
    warnings.add('missing-assets-directory', ASSETS_DIR);
    return null;
  }

  const byId = new Map();
  for (const filename of sortedEntries(dirPath)) {
    const ext = path.extname(filename);
    if (!ext) continue;
    const id = path.basename(filename, ext);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(filename);
  }
  return byId;
}

/**
 * Turn an image uuid into a corpus-relative asset path.
 *
 * When the assets directory was read, a miss returns null rather than a
 * fabricated path — a consumer must be able to tell a real file from a guess.
 * Only when assets/ is absent entirely (already reported once, and flagged by
 * the manifest's `assetsResolved: false`) do we fall back to constructing a path.
 */
function resolveAsset(imageId, assetIndex, kind, ownerSlug, warnings) {
  if (!imageId) return null;

  if (!assetIndex) return `${ASSETS_DIR}/${imageId}${PREFERRED_EXT[kind]}`;

  const candidates = assetIndex.get(imageId);
  if (!candidates || candidates.length === 0) {
    warnings.add('missing-asset', imageId, kind, ownerSlug);
    return null;
  }
  // One uuid can carry several extensions. Prefer the one this record type is
  // expected to use so a static PNG can never displace an animated demo; the
  // sorted listing decides the rest.
  const preferred = candidates.find((f) => f.toLowerCase().endsWith(PREFERRED_EXT[kind]));
  return `${ASSETS_DIR}/${preferred ?? candidates[0]}`;
}

/**
 * Map `Exercise-Name_BodyPart.mp4` onto an exercise slug.
 *
 * Verified against the live corpus: lowercasing and dropping parentheses matches
 * 49 of the 66 videos (e.g. `Assisted-Chest-Dip-(kneeling)_Chest.mp4` ->
 * `assisted-chest-dip-kneeling`). The other 17 have no exercise record at all —
 * the video set and the corpus only partially overlap — and are reported as
 * `unmatched-video` rather than guessed at.
 */
function videoSlug(filename) {
  return filename
    .replace(VIDEO_RE, '')
    .replace(/_[^_]*$/, '')   // trailing _BodyPart, which may itself be hyphenated
    .replace(/[()]/g, '')
    .toLowerCase();
}

/** Append `exerciseSlug` to a null-prototype bucket map, creating it on first use. */
function addToBucket(buckets, key, exerciseSlug) {
  if (!Object.hasOwn(buckets, key)) buckets[key] = [];
  if (!buckets[key].includes(exerciseSlug)) buckets[key].push(exerciseSlug);
}

/**
 * Build the exercise-library index from a corpus directory.
 *
 * @param {string} corpusDir Root holding exercises/, muscles/, muscle_groups/,
 *   equipment/ and optionally assets/ and hevy_videos/.
 * @param {Object} [options]
 * @param {string|null} [options.builtAt] Caller-supplied build timestamp. Injected
 *   rather than read from a clock so the builder stays pure and testable.
 * @returns {{
 *   exercises: Object, muscles: Object, muscleGroups: Object, equipment: Object,
 *   byGroup: Object, byMuscle: Object, byEquipment: Object,
 *   warnings: Array<{kind:string, subject:string, referrer:string|null,
 *                    referencedBy:string|null, count:number}>,
 *   assetsResolved: boolean, builtAt: string|null, version: number
 * }}
 *   All slug-keyed maps have a null prototype. Exercise records carry `image`
 *   (resolved asset path or null), `imageId`, `stills`, `video`, the verbatim
 *   `targetMuscles`/`targetGroups` hints, and the DERIVED `groups`. Muscle
 *   records carry `group` (null when unresolvable) and, only in that case, a
 *   `declaredGroup` preserving what the record claimed.
 */
export function buildExerciseIndex(corpusDir, { builtAt = null } = {}) {
  const warnings = createWarningSink();

  const groupsRead = readCollection(corpusDir, COLLECTIONS.muscleGroups, warnings);
  const musclesRead = readCollection(corpusDir, COLLECTIONS.muscles, warnings);
  const equipmentRead = readCollection(corpusDir, COLLECTIONS.equipment, warnings);
  const exercisesRead = readCollection(corpusDir, COLLECTIONS.exercises, warnings);
  const assetIndex = readAssetIndex(corpusDir, warnings);

  // --- muscle groups -------------------------------------------------------
  const muscleGroups = Object.create(null);
  for (const [slug, record] of groupsRead.records) {
    muscleGroups[slug] = {
      id: toStringOrNull(record.id, 'id', 'muscle-group', slug, warnings),
      slug,
      name: toStringOrNull(record.name, 'name', 'muscle-group', slug, warnings) ?? slug,
      description: toStringOrNull(record.description, 'description', 'muscle-group', slug, warnings),
      muscles: toStringArray(record.muscles, 'muscles', 'muscle-group', slug, warnings),
    };
  }

  // --- muscles -------------------------------------------------------------
  // A muscle's `group` is the ONLY authority on which group an exercise belongs
  // to, so an unresolvable group is a real defect and is reported here —
  // independently of whether any exercise happens to target this muscle.
  const muscles = Object.create(null);
  const muscleGroupOf = new Map();
  for (const [slug, record] of musclesRead.records) {
    const declaredGroup = toStringOrNull(record.group, 'group', 'muscle', slug, warnings);
    const groupExists = declaredGroup !== null && Object.hasOwn(muscleGroups, declaredGroup);

    if (declaredGroup && !groupExists) warnings.add('unknown-group', declaredGroup, 'muscle', slug);
    if (groupExists) muscleGroupOf.set(slug, declaredGroup);

    muscles[slug] = {
      id: toStringOrNull(record.id, 'id', 'muscle', slug, warnings),
      slug,
      name: toStringOrNull(record.name, 'name', 'muscle', slug, warnings) ?? slug,
      group: groupExists ? declaredGroup : null,
      description: toStringOrNull(record.description, 'description', 'muscle', slug, warnings),
      fullDescription: toStringOrNull(record.full_description, 'full_description', 'muscle', slug, warnings),
      imageId: toStringOrNull(record.image, 'image', 'muscle', slug, warnings),
    };
    // Preserved only when it could not be honoured, so a consumer never has to
    // compare two fields to learn whether the group resolved.
    if (declaredGroup && !groupExists) muscles[slug].declaredGroup = declaredGroup;
    muscles[slug].image = resolveAsset(muscles[slug].imageId, assetIndex, 'muscle', slug, warnings);
  }

  // A group may also list muscles that have no record of their own.
  for (const groupSlug of Object.keys(muscleGroups)) {
    for (const muscleSlug of muscleGroups[groupSlug].muscles) {
      if (!Object.hasOwn(muscles, muscleSlug)) {
        warnings.add('unknown-muscle', muscleSlug, 'muscle-group', groupSlug);
      }
    }
  }

  // --- equipment -----------------------------------------------------------
  const equipment = Object.create(null);
  for (const [slug, record] of equipmentRead.records) {
    equipment[slug] = {
      id: toStringOrNull(record.id, 'id', 'equipment', slug, warnings),
      slug,
      name: toStringOrNull(record.name, 'name', 'equipment', slug, warnings) ?? slug,
      description: toStringOrNull(record.description, 'description', 'equipment', slug, warnings),
    };
  }

  // --- companion media -----------------------------------------------------
  // Both are pure filename work off listings already in hand, so the adapter
  // never has to walk the cloud tree to find a demo video or a still.
  const stillsBySlug = new Map();
  for (const filename of exercisesRead.otherFiles) {
    const match = STILL_RE.exec(filename);
    if (!match) continue;
    const slug = match[1];
    if (!stillsBySlug.has(slug)) stillsBySlug.set(slug, []);
    stillsBySlug.get(slug).push(`${COLLECTIONS.exercises.dir}/${filename}`);
  }

  const videoBySlug = new Map();
  const videoDirPath = path.join(corpusDir, VIDEO_DIR);
  const unmatchedVideos = [];
  if (!dirExists(videoDirPath)) {
    warnings.add('missing-directory', VIDEO_DIR);
  } else {
    for (const filename of sortedEntries(videoDirPath)) {
      if (!VIDEO_RE.test(filename)) continue;
      const slug = videoSlug(filename);
      if (!exercisesRead.records.has(slug) || videoBySlug.has(slug)) {
        unmatchedVideos.push(filename);
        continue;
      }
      videoBySlug.set(slug, `${VIDEO_DIR}/${filename}`);
    }
  }
  for (const filename of unmatchedVideos) warnings.add('unmatched-video', filename, 'hevy-video');

  // --- exercises + inverted indexes ---------------------------------------
  const exercises = Object.create(null);
  const byGroup = Object.create(null);
  const byMuscle = Object.create(null);
  const byEquipment = Object.create(null);

  for (const [slug, record] of exercisesRead.records) {
    const targetMuscles = toStringArray(record.target_muscles, 'target_muscles', 'exercise', slug, warnings);
    const targetGroups = toStringArray(record.target_groups, 'target_groups', 'exercise', slug, warnings);
    const equipmentSlugs = toStringArray(record.equipment, 'equipment', 'exercise', slug, warnings);

    // Group membership is DERIVED: exercise -> muscle record -> that muscle's
    // group. The exercise's own `target_groups` is a hint only and never decides
    // membership; it is preserved verbatim so a later audit can diff hint vs.
    // derived, and validated only to surface dangling references.
    const groups = [];
    for (const muscleSlug of targetMuscles) {
      if (!Object.hasOwn(muscles, muscleSlug)) {
        warnings.add('unknown-muscle', muscleSlug, 'exercise', slug);
        continue;
      }
      addToBucket(byMuscle, muscleSlug, slug);
      const group = muscleGroupOf.get(muscleSlug);
      if (group && !groups.includes(group)) groups.push(group);
    }
    for (const group of groups) addToBucket(byGroup, group, slug);

    for (const hinted of targetGroups) {
      if (!Object.hasOwn(muscleGroups, hinted)) {
        warnings.add('unknown-group', hinted, 'exercise', slug);
      }
    }

    for (const equipmentSlug of equipmentSlugs) {
      if (!Object.hasOwn(equipment, equipmentSlug)) {
        warnings.add('unknown-equipment', equipmentSlug, 'exercise', slug);
        continue;
      }
      addToBucket(byEquipment, equipmentSlug, slug);
    }

    const imageId = toStringOrNull(record.image, 'image', 'exercise', slug, warnings);
    exercises[slug] = {
      id: toStringOrNull(record.id, 'id', 'exercise', slug, warnings),
      slug,
      name: toStringOrNull(record.name, 'name', 'exercise', slug, warnings) ?? slug,
      description: toStringOrNull(record.description, 'description', 'exercise', slug, warnings),
      instructions: toStringArray(record.instructions, 'instructions', 'exercise', slug, warnings),
      imageId,
      image: resolveAsset(imageId, assetIndex, 'exercise', slug, warnings),
      stills: stillsBySlug.get(slug) ?? [],
      video: videoBySlug.get(slug) ?? null,
      targetMuscles,
      targetGroups,
      groups,
      equipment: equipmentSlugs,
    };
  }

  // Stable ordering keeps the emitted manifest byte-identical across rebuilds.
  for (const buckets of [byGroup, byMuscle, byEquipment]) {
    for (const key of Object.keys(buckets)) buckets[key].sort();
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
    assetsResolved: assetIndex !== null,
    builtAt,
    version: SCHEMA_VERSION,
  };
}
