// backend/src/4_api/middleware/legacyLocalContentShim.mjs
import express from 'express';
import path from 'path';
import { listYamlFiles, dirExists, listDirs } from '../../0_infrastructure/utils/FileIO.mjs';

/**
 * Scripture volume starting verse IDs
 * Used for resolving verse IDs to volumes
 */
const SCRIPTURE_VOLUMES = {
  ot: 1,
  nt: 23146,
  bom: 31103,
  dc: 37707,
  pgp: 41361,
  lof: 41996
};

/**
 * Get volume from verse ID
 * @param {number} verseId
 * @returns {string|null}
 */
function getVolumeFromVerseId(verseId) {
  const keys = Object.keys(SCRIPTURE_VOLUMES);
  const values = Object.values(SCRIPTURE_VOLUMES);

  for (let i = 0; i < values.length; i++) {
    const start = values[i];
    const end = i === values.length - 1 ? Infinity : values[i + 1] - 1;
    if (verseId >= start && verseId <= end) {
      return keys[i];
    }
  }
  return null;
}

/**
 * Get available version directories for a volume
 * @param {string} dataPath - Base data path
 * @param {string} volume - Volume key (e.g., 'bom')
 * @returns {string|null}
 */
function getDefaultVersion(dataPath, volume) {
  const volumePath = path.join(dataPath, 'content', 'scripture', volume);
  if (!dirExists(volumePath)) return null;

  const versions = listDirs(volumePath);
  return versions.length > 0 ? versions[0] : null;
}

/**
 * Get next unread verse ID from a volume/version directory
 * (Simplified version - just returns first chapter file)
 * @param {string} dataPath - Base data path
 * @param {string} volume
 * @param {string} version
 * @returns {string|null}
 */
function getFirstChapterFromVolume(dataPath, volume, version) {
  const versionPath = path.join(dataPath, 'content', 'scripture', volume, version);
  if (!dirExists(versionPath)) return null;

  const chapters = listYamlFiles(versionPath)
    .sort((a, b) => parseInt(a) - parseInt(b));

  return chapters.length > 0 ? chapters[0] : null;
}

/**
 * Scripture reference resolver
 * Resolves legacy path formats to actual file paths
 */
export class ScripturePathResolver {
  constructor(dataPath) {
    this.dataPath = dataPath;
  }

  /**
   * Resolve scripture path to actual file location
   * @param {string} firstTerm - First path segment
   * @param {string} secondTerm - Second path segment (optional)
   * @returns {{volume: string, version: string, verseId: string}|null}
   */
  resolve(firstTerm, secondTerm) {
    if (!firstTerm) return null;

    let volume = null;
    let version = null;
    let verseId = null;

    // Check if first term is a volume key
    if (SCRIPTURE_VOLUMES[firstTerm]) {
      volume = firstTerm;
      if (secondTerm && !SCRIPTURE_VOLUMES[secondTerm]) {
        // firstTerm is volume, secondTerm is version
        version = secondTerm;
      } else {
        version = getDefaultVersion(this.dataPath, volume);
      }
      verseId = getFirstChapterFromVolume(this.dataPath, volume, version);
    }
    // Check if first term is a numeric verse ID
    else if (/^\d+$/.test(firstTerm)) {
      verseId = firstTerm;
      volume = getVolumeFromVerseId(parseInt(verseId));
      version = secondTerm || getDefaultVersion(this.dataPath, volume);
    }
    // Check if second term is a volume key (reversed order)
    else if (secondTerm && SCRIPTURE_VOLUMES[secondTerm]) {
      volume = secondTerm;
      version = firstTerm;
      verseId = getFirstChapterFromVolume(this.dataPath, volume, version);
    }
    // Assume firstTerm contains the full path
    else {
      // Try to parse as volume/version/verseId or just passthrough
      const parts = firstTerm.split('/');
      if (parts.length >= 2) {
        volume = parts[0];
        version = parts[1];
        verseId = parts[2] || getFirstChapterFromVolume(this.dataPath, volume, version);
      }
    }

    if (!volume || !version) return null;

    return { volume, version, verseId };
  }
}

/**
 * Translate legacy scripture path to new format
 * @param {string} inputPath - Legacy path (e.g., "cfm/1-nephi-1" or "bom/sebom/31103")
 * @param {Object} modifiers - Optional modifiers like { version: 'redc' }
 * @param {string} dataPath - Base data path for filesystem resolution
 * @returns {string|null} New path format or null if cannot resolve
 */
export function translateLegacyScripturePath(inputPath, modifiers = {}, dataPath = null) {
  // Build query string from modifiers
  const queryParams = Object.entries(modifiers)
    .filter(([_, v]) => v != null)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const queryString = queryParams ? `?${queryParams}` : '';

  // If path already looks like volume/version/verseId, pass through
  const parts = inputPath.split('/');
  if (parts.length === 3 && SCRIPTURE_VOLUMES[parts[0]]) {
    return `scripture/${inputPath}${queryString}`;
  }

  // If we don't have dataPath, we can't do filesystem-based resolution
  if (!dataPath) {
    return `scripture/${inputPath}${queryString}`;
  }

  const resolver = new ScripturePathResolver(dataPath);
  const resolved = resolver.resolve(parts[0], parts[1]);

  if (!resolved) {
    // Fallback to passthrough
    return `scripture/${inputPath}${queryString}`;
  }

  const { volume, version, verseId } = resolved;
  return `scripture/${volume}/${version}/${verseId}${queryString}`;
}

/**
 * Translate legacy talk path to new format
 * @param {string} path - Legacy path (e.g., "ldsgc202510/11")
 * @returns {string} New path format
 */
export function translateLegacyTalkPath(path) {
  return `talk/${path}`;
}

/**
 * Translate legacy hymn path to new format
 * @param {string} number - Hymn number
 * @returns {string} New path format
 */
export function translateLegacyHymnPath(number) {
  return `hymn/${number}`;
}

/**
 * Translate legacy primary song path to new format
 * @param {string} number - Primary song number
 * @returns {string} New path format
 */
export function translateLegacyPrimaryPath(number) {
  return `primary/${number}`;
}

/**
 * Translate legacy poetry path to new format
 * @param {string} path - Legacy path (e.g., "remedy/01")
 * @returns {string} New path format
 */
export function translateLegacyPoetryPath(path) {
  return `poem/${path}`;
}

/**
 * Parse legacy input string modifiers
 * Example: "bom; version redc" -> { path: "bom", modifiers: { version: "redc" } }
 * @param {string} input - Input string with optional modifiers
 * @returns {Object} Parsed path and modifiers
 */
export function parseLegacyModifiers(input) {
  const parts = input.split(';').map(p => p.trim());
  const path = parts[0];
  const modifiers = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('version ')) {
      modifiers.version = part.replace('version ', '').trim();
    }
  }

  return { path, modifiers };
}

/**
 * Create middleware for legacy LocalContent endpoints
 * Redirects old /data/* paths to new /api/local-content/* paths
 * @param {Object} config
 * @param {string} config.dataPath - Base data path for filesystem resolution
 * @returns {express.Router}
 */
export function createLegacyLocalContentShim(config = {}) {
  const { dataPath = null } = config;
  const router = express.Router();

  /**
   * GET /data/scripture/*
   * Redirects to /api/local-content/scripture/*
   */
  router.get('/data/scripture/*', async (req, res, next) => {
    const rawPath = req.params[0] || '';
    const { path: inputPath, modifiers } = parseLegacyModifiers(rawPath);
    const newPath = `/api/local-content/${translateLegacyScripturePath(inputPath, modifiers, dataPath)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/talk/*
   * Redirects to /api/local-content/talk/*
   */
  router.get('/data/talk/*', async (req, res, next) => {
    const path = req.params[0] || '';
    const newPath = `/api/local-content/${translateLegacyTalkPath(path)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/hymn/:num
   * Redirects to /api/local-content/hymn/:num
   */
  router.get('/data/hymn/:num', async (req, res, next) => {
    const { num } = req.params;
    const newPath = `/api/local-content/${translateLegacyHymnPath(num)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/primary/:num
   * Redirects to /api/local-content/primary/:num
   */
  router.get('/data/primary/:num', async (req, res, next) => {
    const { num } = req.params;
    const newPath = `/api/local-content/${translateLegacyPrimaryPath(num)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  /**
   * GET /data/poetry/*
   * Redirects to /api/local-content/poem/*
   */
  router.get('/data/poetry/*', async (req, res, next) => {
    const path = req.params[0] || '';
    const newPath = `/api/local-content/${translateLegacyPoetryPath(path)}`;

    req.url = newPath;
    req.originalUrl = newPath;
    next('route');
  });

  return router;
}
