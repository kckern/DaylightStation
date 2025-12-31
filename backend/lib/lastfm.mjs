/**
 * Last.fm Scrobble Harvester
 * 
 * Fetches user's music listening history from Last.fm.
 * Auth: System-level API key + User-level username in data/users/{username}/auth/lastfm.yml
 * 
 * Required auth file structure:
 *   username: <lastfm_username>
 * 
 * Incremental Mode (default):
 *   - Fetches recent scrobbles and merges with existing data
 *   - Dedupes by track timestamp + artist + title
 *   - Use ?full=true for complete re-sync
 */

import axios from './http.mjs';
import moment from 'moment-timezone';
import { userSaveFile, userLoadFile, userLoadAuth, getDefaultUsername } from './io.mjs';
import { createLogger } from './logging/logger.js';

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
    
    // Check for full sync vs incremental
    const fullSync = req?.query?.full === 'true';
    
    // Load existing data for incremental merge
    let existingScrobbles = [];
    if (!fullSync) {
        try {
            existingScrobbles = userLoadFile(username, 'lastfm') || [];
            if (!Array.isArray(existingScrobbles)) existingScrobbles = [];
        } catch (e) {
            // No existing data, will do full sync
            lastfmLogger.info('lastfm.no_existing_data', { username });
        }
    }
    
    try {
        const newScrobbles = [];
        let page = 1;
        const maxPages = fullSync ? 50 : 10; // Limit pages for incremental
        let hasMore = true;
        
        lastfmLogger.info('lastfm.harvest.start', { 
            username: LAST_FM_USER,
            guidId,
            mode: fullSync ? 'full' : 'incremental',
            existingCount: existingScrobbles.length
        });
        
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
            
            const response = await axios.get(
                `https://ws.audioscrobbler.com/2.0/?${new URLSearchParams(params).toString()}`,
                {
                    headers: {
                        'User-Agent': 'DaylightStation-Harvester/1.0',
                        'Accept': 'application/json'
                    }
                }
            );
            
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
            
            // Check if we've reached the end
            const totalPages = parseInt(response.data?.recenttracks?.['@attr']?.totalPages || 1);
            if (page >= totalPages) {
                hasMore = false;
            }
            
            page++;
        }
        
        // Merge and dedupe: newer scrobbles take precedence
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
            mode: fullSync ? 'full' : 'incremental',
            ...stats
        });
        
        // Save merged data
        userSaveFile(username, 'lastfm', mergedScrobbles);
        
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

