/**
 * Pure validation + normalisation of a media manifest (spec §3.2). No I/O.
 *
 * The governing rule: EXTERNAL LOCATORS ARE NOT IDENTITIES. `plex:<ratingKey>`
 * is one current address for the media, and a library rebuild reassigns rating
 * keys freely. So a manifest must also carry durable, human-readable metadata —
 * title plus a series or aliases — enough for a repair tool to find the media
 * again and rebind the locator without touching the units that reference it.
 * A manifest whose only identity is its locator is unrepairable, and is
 * rejected here.
 */

// Locator kinds are a closed table: prefix → full-locator pattern. Adding a
// kind (a new media backend) is one entry plus its adapter — never config,
// because nothing can resolve a kind the code does not know.
export const LOCATOR_KINDS = Object.freeze({
  plex: /^plex:\d+$/,
});

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isNonNegativeInteger = (v) => Number.isInteger(v) && v >= 0;

/**
 * @param {*} raw - one parsed manifest YAML
 * @returns {{ errors: string[], manifest?: object }} empty errors === valid;
 *   `manifest` is present only then.
 */
export function validateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['manifest must be a mapping'] };
  }
  const errors = [];

  if (!isNonEmptyString(raw.id)) errors.push('id is required');
  else if (!ID_PATTERN.test(raw.id)) errors.push(`id must match ${ID_PATTERN.source}, got: ${raw.id}`);

  if (!isNonEmptyString(raw.locator)) {
    errors.push('locator is required');
  } else {
    const kind = raw.locator.split(':')[0];
    const pattern = Object.prototype.hasOwnProperty.call(LOCATOR_KINDS, kind) ? LOCATOR_KINDS[kind] : null;
    if (!pattern) errors.push(`unknown locator kind: ${kind}`);
    else if (!pattern.test(raw.locator)) errors.push(`locator is not a valid ${kind} locator: ${raw.locator}`);
  }

  if (!isNonEmptyString(raw.title)) errors.push('title is required');

  let series;
  if (raw.series !== undefined && raw.series !== null) {
    if (!isNonEmptyString(raw.series)) errors.push('series must be a non-empty string');
    else series = raw.series;
  }
  let aliases = [];
  if (raw.aliases !== undefined && raw.aliases !== null) {
    if (!Array.isArray(raw.aliases) || raw.aliases.length === 0 || !raw.aliases.every(isNonEmptyString)) {
      errors.push('aliases must be a non-empty array of non-empty strings');
    } else {
      aliases = raw.aliases;
    }
  }
  // Only WELL-FORMED metadata counts: a blank series leaves the manifest just
  // as unrepairable as an absent one.
  if (series === undefined && aliases.length === 0) {
    errors.push('manifest needs series or aliases — a locator is not an identity');
  }

  const season = optionalIndex(raw, 'season', errors);
  const episode = optionalIndex(raw, 'episode', errors);

  let durationSec;
  if (raw.durationSec !== undefined && raw.durationSec !== null) {
    if (!Number.isInteger(raw.durationSec) || raw.durationSec <= 0) errors.push('durationSec must be an integer > 0');
    else durationSec = raw.durationSec;
  }

  // Contents are free-form (source, licence context, who added it): validation
  // demands the record exists, runtime never reads it.
  if (!raw.provenance || typeof raw.provenance !== 'object' || Array.isArray(raw.provenance)) {
    errors.push('provenance must be an object');
  }

  if (errors.length) return { errors };
  return {
    errors,
    manifest: {
      id: raw.id,
      locator: raw.locator,
      title: raw.title,
      series,
      aliases,
      season,
      episode,
      durationSec,
      provenance: raw.provenance,
    },
  };
}

/** Season/episode: absent, or an integer >= 0 (season 0 = specials). */
function optionalIndex(raw, field, errors) {
  if (raw[field] === undefined) return undefined;
  if (!isNonNegativeInteger(raw[field])) {
    errors.push(`${field} must be an integer >= 0`);
    return undefined;
  }
  return raw[field];
}
