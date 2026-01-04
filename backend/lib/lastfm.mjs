/**
 * Last.fm Scrobble Harvester
 * 
 * Fetches user's music listening history from Last.fm.
 * Auth: System-level API key + User-level username in data/users/{username}/auth/lastfm.yml
 * 
 * Required auth file structure:
 *   username: <lastfm_username>
 * 
 * Modes:
 *   - Incremental (default): Fetches recent scrobbles, merges with hot storage
 *   - Full sync (?full=true): Fetches all, partitions to hot + cold archives
 *   - Backfill (?backfill2009=true): Writes directly to yearly archives
 * 
 * Storage:
 *   - Hot: users/{user}/lifelog/lastfm.yml (recent 90 days)
 *   - Cold: users/{user}/lifelog/archives/lastfm/{year}.yml (historical)
 */

import axios from './http.mjs';
import moment from 'moment-timezone';
import { userSaveFile, userLoadFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { createLogger } from './logging/logger.js';
import ArchiveService from './ArchiveService.mjs';

const lastfmLogger = createLogger({ source: 'backend', app: 'lastfm' });

/**
 * Parse a raw Last.fm scrobble into our normalized format
 * @param {object} track - Raw track from API
 * @returns {object} Normalized scrobble object
 */
const parseScrobble = (track) => {
    // Skip "now playing" tracks (they don't have date)
    if (!track.date) return null;
    
    return {
        id: `${track.date.uts}-${track.artist['#text']}-${track.name}`.replace(/[^a-z0-9-]/gi, '_'),
        unix: parseInt(track.date.uts),
        date: track.date['#text'],
        timestamp: parseInt(track.date.uts),
        artist: track.artist['#text'],
        album: track.album['#text'],
        title: track.name,
        mbid: track.mbid || null,
        url: track.url || null,
        image: track.image?.find(img => img.size === 'large')?.['#text'] || null
    };
};

/**
 * Fetch user's Last.fm scrobbles (incremental by default)
 * @param {string} guidId - Request ID for logging
 * @param {object} req - Express request object (optional)
 *   - req.query.full: If 'true', fetch all scrobbles (not incremental)
 *   - req.targetUsername: Override default username
 * @returns {Promise<Array>} Array of scrobble activities
 */
const getScrobbles = async (guidId = null, req = null) => {
    // System-level API key (shared app key)
    const { LAST_FM_API_KEY } = process.env;
    
    if (!LAST_FM_API_KEY) {
        lastfmLogger.error('lastfm.api_key.missing', { 
            message: 'No Last.fm API key found in system config',
            suggestion: 'Add LAST_FM_API_KEY to config.secrets.yml'
        });
        throw new Error('Last.fm API key not configured');
    }
    
    // User-level auth (personal username)
    const targetUsername = req?.targetUsername;
    const username = targetUsername || getDefaultUsername();
    const auth = userLoadAuth(username, 'lastfm') || {};
    const LAST_FM_USER = auth.username || process.env.LAST_FM_USER;
    
    if (!LAST_FM_USER) {
        lastfmLogger.error('lastfm.username.missing', { 
            message: 'No Last.fm username found',
            username,
            suggestion: 'Create data/users/{username}/auth/lastfm.yml with username field'
        });
        throw new Error('Last.fm username not configured');
    }
    
    // Check for full sync vs incremental vs backfill
    const fullSync = req?.query?.full === 'true';
    const backfillTo2009 = req?.query?.backfill2009 === 'true';
    
    // Check if archive service is enabled for lastfm
    const archiveEnabled = ArchiveService.isArchiveEnabled('lastfm');
    const archiveConfig = archiveEnabled ? ArchiveService.getConfig('lastfm') : null;
    const retentionDays = archiveConfig?.retentionDays || 90;
    const cutoffDate = moment().subtract(retentionDays, 'days');
    
    // Load existing data for incremental merge
    // For incremental mode with archive: only load hot storage
    // For backfill: we don't need existing data (write directly to archives)
    let existingScrobbles = [];
    let oldestTimestamp = null;
    try {
        if (backfillTo2009 && archiveEnabled) {
            // Backfill mode with archive: load hot to find oldest timestamp, but won't save back to it
            existingScrobbles = ArchiveService.getHotData(username, 'lastfm') || [];
        } else if (archiveEnabled) {
            // Normal mode with archive: only load hot storage
            existingScrobbles = ArchiveService.getHotData(username, 'lastfm') || [];
        } else {
            // No archive: load full file (legacy behavior)
            existingScrobbles = userLoadFile(username, 'lastfm') || [];
        }
        if (!Array.isArray(existingScrobbles)) existingScrobbles = [];
        
        // Find oldest timestamp for backfill mode
        if (backfillTo2009 && existingScrobbles.length > 0) {
            const oldest = existingScrobbles[existingScrobbles.length - 1]; // Last in array (sorted newest first)
            oldestTimestamp = oldest.timestamp;
            const oldestDate = moment.unix(oldestTimestamp).format('YYYY-MM-DD HH:mm:ss');
            lastfmLogger.info('lastfm.found_oldest', { 
                username,
                oldestDate,
                timestamp: oldestTimestamp,
                totalExisting: existingScrobbles.length
            });
        }
    } catch (e) {
        // No existing data, will do full sync
        lastfmLogger.info('lastfm.no_existing_data', { username });
    }
    
    try {
        const newScrobbles = [];
        let page = 1;
        const maxPages = backfillTo2009 ? 100000 : (fullSync ? 50 : 10); // No limit for 2009 backfill
        let hasMore = true;
        
        lastfmLogger.info('lastfm.harvest.start', { 
            username: LAST_FM_USER,
            guidId,
            mode: backfillTo2009 ? 'backfill-2009' : (fullSync ? 'full' : 'incremental'),
            existingCount: existingScrobbles.length
        });
        
        // Track for incremental saves
        let scrobblesSinceLastSave = 0;
        const SAVE_INTERVAL = backfillTo2009 ? 1000 : 2000; // Save every 1000 scrobbles for 2009 backfill
        
        // Paginate through scrobbles
        while (hasMore && page <= maxPages) {
            const params = {
                'api_key': LAST_FM_API_KEY,
                'user': LAST_FM_USER,
                'limit': 200,
                'method': 'user.getRecentTracks',
                'page': page,
                'format': 'json'
            };
            
            // For backfill mode, fetch older tracks using 'to' parameter
            if (backfillTo2009 && oldestTimestamp) {
                params.to = oldestTimestamp - 1; // Fetch tracks older than our oldest
            }
            
            let retries = 3;
            let response = null;
            
            // Retry logic for API failures
            while (retries > 0) {
                try {
                    response = await axios.get(
                        `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams(params).toString()}`,
                        {
                            headers: {
                                'User-Agent': 'DaylightStation-Harvester/1.0',
                                'Accept': 'application/json'
                            },
                            timeout: 10000 // 10 second timeout
                        }
                    );
                    break; // Success, exit retry loop
                } catch (err) {
                    retries--;
                    
                    const isTimeout = err.code === 'ETIMEDOUT' || 
                                     err.code === 'ECONNABORTED' ||
                                     err.message?.includes('timeout');
                    
                    if (retries === 0) {
                        // Final failure - log with clear error type
                        lastfmLogger.error('lastfm.api_error.final', {
                            username: LAST_FM_USER,
                            page,
                            error: err.message,
                            code: err.code,
                            isTimeout,
                            statusCode: err.response?.status
                        });
                        throw err; // Out of retries
                    }
                    
                    const waitTime = (4 - retries) * 2000; // 2s, 4s, 6s
                    lastfmLogger.warn('lastfm.api_error.retrying', {
                        username: LAST_FM_USER,
                        page,
                        retriesLeft: retries,
                        waitTime,
                        error: err.message,
                        code: err.code,
                        isTimeout
                    });
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }
            
            const tracks = response.data?.recenttracks?.track;
            if (!tracks || tracks.length === 0) {
                hasMore = false;
                break;
            }
            
            // Parse tracks (skip "now playing")
            const parsedTracks = (Array.isArray(tracks) ? tracks : [tracks])
                .map(parseScrobble)
                .filter(t => t !== null);
            
            newScrobbles.push(...parsedTracks);
            scrobblesSinceLastSave += parsedTracks.length;
            
            // Log progress
            if (page % 10 === 0) {
                const oldestTrack = parsedTracks[parsedTracks.length - 1];
                const oldestDate = oldestTrack ? moment.unix(oldestTrack.timestamp).format('YYYY-MM-DD') : 'unknown';
                lastfmLogger.info('lastfm.harvest.progress', {
                    username: LAST_FM_USER,
                    page,
                    totalPages: response.data?.recenttracks?.['@attr']?.totalPages || '?',
                    fetchedSoFar: newScrobbles.length,
                    oldestDate
                });
            }
            
            // Incremental save for 2009 backfill
            if (backfillTo2009 && scrobblesSinceLastSave >= SAVE_INTERVAL) {
                if (archiveEnabled) {
                    // Archive mode: write directly to yearly archives (skip hot storage)
                    const result = ArchiveService.appendToArchive(username, 'lastfm', newScrobbles);
                    
                    const oldestTrack = newScrobbles[newScrobbles.length - 1];
                    const oldestDate = oldestTrack ? moment.unix(oldestTrack.timestamp).format('YYYY-MM-DD') : 'unknown';
                    
                    lastfmLogger.info('lastfm.incremental_save.archive', {
                        username: LAST_FM_USER,
                        page,
                        scrobblesArchived: result.entriesProcessed,
                        yearsUpdated: result.yearsUpdated,
                        oldestDate
                    });
                    
                    newScrobbles.length = 0; // Clear new scrobbles array
                    scrobblesSinceLastSave = 0;
                } else {
                    // Legacy mode: merge with existing and save to single file
                    const existingById = new Map(existingScrobbles.map(s => [s.id, s]));
                    for (const scrobble of newScrobbles) {
                        existingById.set(scrobble.id, scrobble);
                    }
                    
                    const mergedSoFar = Array.from(existingById.values())
                        .sort((a, b) => b.timestamp - a.timestamp);
                    
                    userSaveFile(username, 'lastfm', mergedSoFar);
                    existingScrobbles = mergedSoFar;
                    newScrobbles.length = 0;
                    scrobblesSinceLastSave = 0;
                    
                    const oldestTrack = mergedSoFar[mergedSoFar.length - 1];
                    const oldestDate = oldestTrack ? moment.unix(oldestTrack.timestamp).format('YYYY-MM-DD') : 'unknown';
                    
                    lastfmLogger.info('lastfm.incremental_save', {
                        username: LAST_FM_USER,
                        page,
                        totalScrobbles: mergedSoFar.length,
                        oldestDate
                    });
                }
            }
            
            // Check for 2009 cutoff
            if (backfillTo2009 && parsedTracks.length > 0) {
                const oldestInBatch = parsedTracks[parsedTracks.length - 1];
                const oldestYear = moment.unix(oldestInBatch.timestamp).year();
                if (oldestYear < 2009) {
                    lastfmLogger.info('lastfm.reached_2009', {
                        username: LAST_FM_USER,
                        page,
                        date: moment.unix(oldestInBatch.timestamp).format('YYYY-MM-DD')
                    });
                    hasMore = false;
                    break;
                }
            }
            
            // Check if we've reached the end
            const totalPages = parseInt(response.data?.recenttracks?.['@attr']?.totalPages || 1);
            if (page >= totalPages) {
                hasMore = false;
            }
            
            page++;
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Final merge and dedupe: newer scrobbles take precedence
        const existingById = new Map(existingScrobbles.map(s => [s.id, s]));
        for (const scrobble of newScrobbles) {
            existingById.set(scrobble.id, scrobble);
        }
        
        // Convert back to array and sort by timestamp (newest first)
        const mergedScrobbles = Array.from(existingById.values())
            .sort((a, b) => b.timestamp - a.timestamp);
        
        // Generate stats
        const stats = {
            total: mergedScrobbles.length,
            newFetched: newScrobbles.length,
            previousCount: existingScrobbles.length,
            uniqueArtists: [...new Set(mergedScrobbles.map(s => s.artist))].length,
            uniqueAlbums: [...new Set(mergedScrobbles.map(s => s.album).filter(Boolean))].length,
            dateRange: mergedScrobbles.length > 0 ? {
                oldest: moment.unix(mergedScrobbles[mergedScrobbles.length - 1].timestamp).format('YYYY-MM-DD'),
                newest: moment.unix(mergedScrobbles[0].timestamp).format('YYYY-MM-DD')
            } : null
        };
        
        lastfmLogger.info('lastfm.harvest.success', { 
            username: LAST_FM_USER,
            guidId,
            mode: backfillTo2009 ? 'backfill' : (fullSync ? 'full' : 'incremental'),
            archiveEnabled,
            ...stats
        });
        
        // Save data based on mode and archive settings
        if (archiveEnabled) {
            if (backfillTo2009) {
                // Backfill mode: write remaining new scrobbles directly to archives
                if (newScrobbles.length > 0) {
                    ArchiveService.appendToArchive(username, 'lastfm', newScrobbles);
                }
                // Don't touch hot storage in backfill mode
                lastfmLogger.info('lastfm.backfill.complete', {
                    username: LAST_FM_USER,
                    scrobblesArchived: newScrobbles.length
                });
            } else if (fullSync) {
                // Full sync: partition into hot (recent) and cold (old)
                const hotScrobbles = [];
                const coldScrobbles = [];
                
                for (const scrobble of mergedScrobbles) {
                    const scrobbleDate = moment.unix(scrobble.timestamp);
                    if (scrobbleDate.isAfter(cutoffDate)) {
                        hotScrobbles.push(scrobble);
                    } else {
                        coldScrobbles.push(scrobble);
                    }
                }
                
                // Save hot data
                ArchiveService.saveToHot(username, 'lastfm', hotScrobbles);
                
                // Archive cold data
                if (coldScrobbles.length > 0) {
                    ArchiveService.appendToArchive(username, 'lastfm', coldScrobbles);
                }
                
                lastfmLogger.info('lastfm.fullsync.partitioned', {
                    username: LAST_FM_USER,
                    hotCount: hotScrobbles.length,
                    coldCount: coldScrobbles.length
                });
            } else {
                // Incremental mode: save to hot, then rotate if needed
                ArchiveService.saveToHot(username, 'lastfm', mergedScrobbles);
                
                // Rotate old entries to archives
                const rotateResult = ArchiveService.rotateToArchive(username, 'lastfm');
                if (rotateResult.rotated > 0) {
                    lastfmLogger.info('lastfm.archive.rotated', {
                        username: LAST_FM_USER,
                        rotated: rotateResult.rotated,
                        kept: rotateResult.kept,
                        yearsUpdated: rotateResult.yearsUpdated
                    });
                }
            }
        } else {
            // Legacy mode: save to single file
            userSaveFile(username, 'lastfm', mergedScrobbles);
        }
        
        return mergedScrobbles;
        
    } catch (error) {
        const statusCode = error.response?.status;
        const errorMessage = error.response?.data?.message;
        
        if (statusCode === 401 || statusCode === 403) {
            lastfmLogger.error('lastfm.auth.invalid', { 
                message: 'Last.fm API key is invalid',
                username: LAST_FM_USER,
                statusCode
            });
            throw new Error('Last.fm API key is invalid');
        }
        
        if (statusCode === 404) {
            lastfmLogger.error('lastfm.user.not_found', { 
                message: 'Last.fm user not found',
                username: LAST_FM_USER
            });
            throw new Error(`Last.fm user '${LAST_FM_USER}' not found`);
        }
        
        if (statusCode === 429) {
            lastfmLogger.error('lastfm.rate_limit', { 
                message: 'Last.fm API rate limit exceeded',
                username: LAST_FM_USER
            });
            throw new Error('Last.fm API rate limit exceeded');
        }
        
        lastfmLogger.error('lastfm.fetch.failed', { 
            error: error.message,
            statusCode,
            errorMessage,
            username: LAST_FM_USER
        });
        throw error;
    }
};

export default getScrobbles;

