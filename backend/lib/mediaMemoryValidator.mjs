/**
 * Media Memory Validator
 *
 * Daily cron job to validate Plex IDs in media_memory and auto-backfill orphans.
 *
 * Safety:
 * - Aborts if Plex server unreachable
 * - Only updates when high-confidence match found (>90%)
 * - Preserves old IDs in oldPlexIds array
 * - Writes work log on changes
 */

import path from 'path';
import fs from 'fs';
import moment from 'moment-timezone';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import stringSimilarity from 'string-similarity';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';
import { configService } from './config/ConfigService.mjs';
import { getMediaMemoryDir, getMediaMemoryFiles } from './mediaMemory.mjs';

const logger = createLogger({ source: 'cron', app: 'mediaMemoryValidator' });

const MIN_CONFIDENCE = 90;
const RECENT_DAYS = 30;
const SAMPLE_PERCENT = 10;

class PlexClient {
    constructor() {
        const auth = configService.getHouseholdAuth('plex') || {};
        this.token = auth.token;
        const { plex: plexEnv } = process.env;
        this.host = auth.server_url?.replace(/:\d+$/, '') || plexEnv?.host;
        this.port = plexEnv?.port;
        this.baseUrl = this.port ? `${this.host}:${this.port}` : this.host;
    }

    async fetch(endpoint) {
        const url = `${this.baseUrl}/${endpoint}`;
        const separator = url.includes('?') ? '&' : '?';
        const fullUrl = `${url}${separator}X-Plex-Token=${this.token}`;
        try {
            const response = await axios.get(fullUrl, { headers: { Accept: 'application/json' } });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }

    async checkConnectivity() {
        try {
            const data = await this.fetch('identity');
            return !!data?.MediaContainer?.machineIdentifier;
        } catch {
            return false;
        }
    }

    async verifyId(plexId) {
        const data = await this.fetch(`library/metadata/${plexId}`);
        return data?.MediaContainer?.Metadata?.[0] || null;
    }

    async hubSearch(query, libraryId = null) {
        const sectionParam = libraryId ? `&sectionId=${libraryId}` : '';
        const data = await this.fetch(`hubs/search?query=${encodeURIComponent(query)}${sectionParam}`);
        const hubs = data?.MediaContainer?.Hub || [];
        const results = [];
        for (const hub of hubs) {
            for (const item of (hub.Metadata || [])) {
                results.push({
                    id: item.ratingKey,
                    title: item.title,
                    parent: item.parentTitle,
                    grandparent: item.grandparentTitle,
                    type: item.type
                });
            }
        }
        return results;
    }
}

function calculateConfidence(stored, result) {
    const titleSim = stringSimilarity.compareTwoStrings(
        (stored.title || '').toLowerCase(),
        (result.title || '').toLowerCase()
    );

    let parentSim = 0;
    if (stored.parent && result.parent) {
        parentSim = stringSimilarity.compareTwoStrings(
            stored.parent.toLowerCase(),
            result.parent.toLowerCase()
        );
    }

    let grandparentSim = 0;
    if (stored.grandparent && result.grandparent) {
        grandparentSim = stringSimilarity.compareTwoStrings(
            stored.grandparent.toLowerCase(),
            result.grandparent.toLowerCase()
        );
    }

    // Weight: title 50%, grandparent 30%, parent 20%
    const score = (titleSim * 0.5) + (grandparentSim * 0.3) + (parentSim * 0.2);
    return Math.round(score * 100);
}

async function findBestMatch(plex, entry) {
    const queries = [];
    if (entry.grandparent && entry.title) {
        queries.push(`${entry.grandparent} ${entry.title}`);
    }
    if (entry.title) {
        queries.push(entry.title);
    }

    let bestMatch = null;
    let bestConfidence = 0;

    for (const query of queries) {
        const results = await plex.hubSearch(query, entry.libraryId);
        for (const result of results) {
            const confidence = calculateConfidence(entry, result);
            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestMatch = { ...result, confidence };
            }
            if (confidence >= 95) break;
        }
        if (bestConfidence >= MIN_CONFIDENCE) break;
    }

    return bestMatch;
}

function selectEntriesToCheck(entries) {
    const now = moment();
    const recentCutoff = moment().subtract(RECENT_DAYS, 'days');

    const recent = [];
    const older = [];

    for (const [id, entry] of entries) {
        const lastPlayed = moment(entry.lastPlayed);
        if (lastPlayed.isValid() && lastPlayed.isAfter(recentCutoff)) {
            recent.push([id, entry]);
        } else {
            older.push([id, entry]);
        }
    }

    // Sample older entries
    const sampleCount = Math.ceil(older.length * SAMPLE_PERCENT / 100);
    const shuffled = older.sort(() => Math.random() - 0.5);
    const sampled = shuffled.slice(0, sampleCount);

    return [...recent, ...sampled];
}

export default async function validateMediaMemory(guidId) {
    logger.info('mediaMemory.validator.started', { guidId });

    const plex = new PlexClient();

    // Safety: Check connectivity first
    if (!await plex.checkConnectivity()) {
        logger.warn('mediaMemory.validator.aborted', { reason: 'Plex unreachable' });
        return;
    }

    const files = getMediaMemoryFiles();
    const stats = { checked: 0, valid: 0, backfilled: 0, unresolved: 0 };
    const allChanges = [];
    const allUnresolved = [];

    for (const fileInfo of files) {
        const content = fs.readFileSync(fileInfo.path, 'utf8');
        const data = parseYaml(content) || {};
        const entries = Object.entries(data);

        const toCheck = selectEntriesToCheck(entries);
        let fileModified = false;

        for (const [plexId, entry] of toCheck) {
            stats.checked++;

            const exists = await plex.verifyId(plexId);
            if (exists) {
                stats.valid++;
                continue;
            }

            // ID is orphaned - try to find match
            logger.info('mediaMemory.validator.orphanFound', {
                id: plexId,
                title: entry.title,
                file: fileInfo.filename
            });

            const match = await findBestMatch(plex, entry);

            if (match && match.confidence >= MIN_CONFIDENCE) {
                stats.backfilled++;

                // Update entry with new ID
                const oldIds = entry.oldPlexIds || [];
                oldIds.push(parseInt(plexId, 10));

                const updatedEntry = {
                    ...entry,
                    oldPlexIds: oldIds
                };

                // Remove old key, add new
                delete data[plexId];
                data[match.id] = updatedEntry;
                fileModified = true;

                const change = {
                    file: fileInfo.filename,
                    oldId: parseInt(plexId, 10),
                    newId: parseInt(match.id, 10),
                    title: entry.title,
                    parent: entry.parent,
                    grandparent: entry.grandparent,
                    confidence: match.confidence,
                    timestamp: new Date().toISOString()
                };
                allChanges.push(change);

                logger.info('mediaMemory.validator.backfilled', change);
            } else {
                stats.unresolved++;
                const unresolved = {
                    file: fileInfo.filename,
                    id: parseInt(plexId, 10),
                    title: entry.title,
                    reason: match ? `low confidence (${match.confidence}%)` : 'no match found'
                };
                allUnresolved.push(unresolved);

                logger.warn('mediaMemory.validator.noMatch', unresolved);
            }
        }

        if (fileModified) {
            const yaml = stringifyYaml(data, { lineWidth: 0 });
            fs.writeFileSync(fileInfo.path, yaml, 'utf8');
        }
    }

    // Write work log if changes or unresolved
    if (allChanges.length > 0 || allUnresolved.length > 0) {
        const logsDir = path.join(getMediaMemoryDir(), 'plex', '_logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const logFile = path.join(logsDir, `${moment().format('YYYY-MM-DD')}.yml`);
        const logData = {
            date: moment().format('YYYY-MM-DD'),
            runTime: new Date().toISOString(),
            summary: stats,
            ...(allChanges.length > 0 && { changes: allChanges }),
            ...(allUnresolved.length > 0 && { unresolved: allUnresolved })
        };

        fs.writeFileSync(logFile, stringifyYaml(logData, { lineWidth: 0 }), 'utf8');
        logger.info('mediaMemory.validator.logWritten', { path: logFile });
    }

    logger.info('mediaMemory.validator.complete', stats);
}
