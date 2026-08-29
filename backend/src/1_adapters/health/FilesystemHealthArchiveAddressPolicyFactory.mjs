import path from 'node:path';
import { IHealthArchiveAddressPolicyFactory } from '#apps/health/ports/IHealthArchiveAddressPolicyFactory.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

/**
 * Concrete F-106 layout:
 *   data/users/{userId}/lifelog/archives/{weight and allowed categories}
 *   data/users/{userId}/health.yml
 *   media/archives/{configured workout source}/**
 */
export class FilesystemHealthArchiveAddressPolicyFactory extends IHealthArchiveAddressPolicyFactory {
  create({ dataRoot, mediaRoot } = {}) {
    if (!dataRoot || typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) {
      throw new ValidationError(
        `HealthArchiveScope: dataRoot must be an absolute path string (got: ${String(dataRoot)})`,
        { code: 'INVALID_DATA_ROOT', field: 'dataRoot', value: dataRoot },
      );
    }
    if (!mediaRoot || typeof mediaRoot !== 'string' || !path.isAbsolute(mediaRoot)) {
      throw new ValidationError(
        `HealthArchiveScope: mediaRoot must be an absolute path string (got: ${String(mediaRoot)})`,
        { code: 'INVALID_MEDIA_ROOT', field: 'mediaRoot', value: mediaRoot },
      );
    }
    return new FilesystemHealthArchiveAddressPolicy({ dataRoot, mediaRoot });
  }
}

class FilesystemHealthArchiveAddressPolicy {
  #dataRoot;
  #mediaRoot;

  constructor({ dataRoot, mediaRoot }) {
    this.#dataRoot = path.normalize(dataRoot);
    this.#mediaRoot = path.normalize(mediaRoot);
  }

  get dataRoot() { return this.#dataRoot; }
  get mediaRoot() { return this.#mediaRoot; }

  isReadableLocation({ location, userId, workoutSources, isPrivacyExcluded }) {
    if (!location || typeof location !== 'string' || location.includes('\0')) return false;
    if (!path.isAbsolute(location)) return false;

    const normalized = path.normalize(location);
    if (isPrivacyExcluded(normalized)) return false;

    if (withinRoot(normalized, this.#mediaRoot)
        && buildSharedTails(workoutSources).some((tail) => tail.test(normalized))) {
      return true;
    }
    if (!withinRoot(normalized, this.#dataRoot)) return false;
    return buildUserWhitelistTails(userId, workoutSources).some((tail) => tail.test(normalized));
  }
}

function buildUserWhitelistTails(userId, workoutSources) {
  const user = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = `users/${user}/lifelog/archives`;
  return [
    new RegExp(`(?:^|\\/)${base}\\/weight\\.yaml$`),
    new RegExp(`(?:^|\\/)${base}\\/nutrition-history\\/.+`),
    new RegExp(`(?:^|\\/)${base}\\/scans\\/.+`),
    new RegExp(`(?:^|\\/)${base}\\/notes\\/.+`),
    new RegExp(`(?:^|\\/)${base}\\/playbook\\/.+`),
    new RegExp(`(?:^|\\/)users\\/${user}\\/health\\.yml$`),
    ...workoutSources.map((source) => new RegExp(`(?:^|\\/)${base}\\/${source}\\/.+`)),
  ];
}

function buildSharedTails(workoutSources) {
  return workoutSources.map((source) => new RegExp(`(?:^|\\/)archives\\/${source}\\/.+`));
}

function withinRoot(location, root) {
  if (!location.startsWith(root)) return false;
  return location.length === root.length || location[root.length] === path.sep;
}
