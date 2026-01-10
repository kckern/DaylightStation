/**
 * Foursquare/Swarm Check-in Harvester
 * 
 * Fetches user's location check-in history from Foursquare/Swarm.
 * Auth: User-level OAuth token in data/users/{username}/auth/foursquare.yml
 * 
 * Required auth file structure:
 *   token: <oauth_access_token>
 * 
 * Note: Uses Foursquare API v2 for Swarm check-ins
 * API Docs: https://developer.foursquare.com/docs/api-reference/users/checkins/
 * 
 * Incremental Mode (default):
 *   - Fetches only last 30 days of check-ins
 *   - Merges with existing data, deduping by ID
 *   - Use ?full=true for complete re-sync
 *   - Use ?days=N to customize lookback period
 */

import axios from './http.mjs';
import moment from 'moment-timezone';
import { userSaveFile, userLoadFile, getDefaultUsername } from './io.mjs';
import { configService } from './config/v2/index.mjs';
import { createLogger } from './logging/logger.js';

const foursquareLogger = createLogger({ source: 'backend', app: 'foursquare' });

// Foursquare API version date (required param)
const API_VERSION = '20231231';

// Default to fetch last 30 days for incremental updates
const DEFAULT_DAYS_BACK = 30;

/**
 * Parse a raw Foursquare checkin into our normalized format
 * @param {object} checkin - Raw checkin from API
 * @returns {object} Normalized checkin object
 */
const parseCheckin = (checkin) => {
    const venue = checkin.venue || {};
    const location = venue.location || {};
    const categories = venue.categories || [];
    const primaryCategory = categories.find(c => c.primary) || categories[0];
    
    return {
        id: checkin.id,
        type: 'checkin',
        createdAt: moment.unix(checkin.createdAt).toISOString(),
        date: moment.unix(checkin.createdAt).format('YYYY-MM-DD'),
        timestamp: checkin.createdAt,
        timezone: checkin.timeZoneOffset,
        
        // Venue info
        venue: {
            id: venue.id,
            name: venue.name,
            category: primaryCategory?.name || null,
            categoryIcon: primaryCategory?.icon ? 
                `${primaryCategory.icon.prefix}64${primaryCategory.icon.suffix}` : null,
            url: venue.url || null
        },
        
        // Location
        location: {
            address: location.address || null,
            city: location.city || null,
            state: location.state || null,
            country: location.country || null,
            postalCode: location.postalCode || null,
            lat: location.lat,
            lng: location.lng,
            formattedAddress: location.formattedAddress?.join(', ') || null
        },
        
        // Check-in details
        shout: checkin.shout || null, // User comment
        photos: (checkin.photos?.items || []).map(photo => ({
            id: photo.id,
            url: `${photo.prefix}original${photo.suffix}`,
            width: photo.width,
            height: photo.height
        })),
        
        // Social
        likes: checkin.likes?.count || 0,
        comments: (checkin.comments?.items || []).map(comment => ({
            id: comment.id,
            text: comment.text,
            createdAt: moment.unix(comment.createdAt).toISOString()
        })),
        
        // Source app
        source: checkin.source?.name || 'Swarm',
        
        // Private flag
        private: checkin.private || false,
        
        // Event if applicable
        event: checkin.event ? {
            id: checkin.event.id,
            name: checkin.event.name
        } : null
    };
};

/**
 * Fetch user's Foursquare/Swarm check-ins (incremental by default)
 * @param {string} guidId - Request ID for logging
 * @param {object} req - Express request object (optional)
 *   - req.query.full: If 'true', fetch all check-ins (not incremental)
 *   - req.query.days: Number of days back to fetch (default: 30)
 * @returns {Promise<Array>} Array of check-in activities
 */
const getFoursquareCheckins = async (guidId = null, req = null) => {
    const targetUsername = req?.targetUsername;
    const username = targetUsername || getDefaultUsername();
    const auth = configService.getUserAuth('foursquare', username) || {};
    
    const FOURSQUARE_TOKEN = auth.token || process.env.FOURSQUARE_TOKEN;
    
    if (!FOURSQUARE_TOKEN) {
        foursquareLogger.error('foursquare.auth.missing', { 
            message: 'No Foursquare OAuth token found',
            username,
            suggestion: 'Create data/users/{username}/auth/foursquare.yml with token field'
        });
        throw new Error('Foursquare OAuth token not configured');
    }
    
    // Check for full sync vs incremental
    const fullSync = req?.query?.full === 'true';
    const daysBack = parseInt(req?.query?.days) || DEFAULT_DAYS_BACK;
    
    // Load existing data for incremental merge
    let existingCheckins = [];
    if (!fullSync) {
        try {
            existingCheckins = userLoadFile(username, 'checkins') || [];
            if (!Array.isArray(existingCheckins)) existingCheckins = [];
        } catch (e) {
            // No existing data, will do full sync
            foursquareLogger.info('foursquare.no_existing_data', { username });
        }
    }
    
    // Calculate time window for incremental fetch
    const afterTimestamp = fullSync ? null : moment().subtract(daysBack, 'days').unix();
    
    try {
        const newCheckins = [];
        let offset = 0;
        const limit = 250; // Max per request
        let hasMore = true;
        
        foursquareLogger.info('foursquare.harvest.start', { 
            username, 
            guidId,
            mode: fullSync ? 'full' : 'incremental',
            daysBack: fullSync ? 'all' : daysBack,
            existingCount: existingCheckins.length
        });
        
        // Paginate through check-ins
        while (hasMore) {
            const params = {
                oauth_token: FOURSQUARE_TOKEN,
                v: API_VERSION,
                limit: limit,
                offset: offset,
                sort: 'newestfirst'
            };
            
            // For incremental, use afterTimestamp to limit results
            if (afterTimestamp) {
                params.afterTimestamp = afterTimestamp;
            }
            
            const response = await axios.get(
                'https://api.foursquare.com/v2/users/self/checkins',
                {
                    params,
                    headers: {
                        'User-Agent': 'DaylightStation-Harvester/1.0',
                        'Accept': 'application/json'
                    }
                }
            );
            
            const items = response.data?.response?.checkins?.items || [];
            
            if (items.length === 0) {
                hasMore = false;
                break;
            }
            
            for (const checkin of items) {
                newCheckins.push(parseCheckin(checkin));
            }
            
            offset += items.length;
            
            // Safety limit to prevent infinite loops
            if (offset >= 10000) {
                foursquareLogger.warn('foursquare.pagination.limit', {
                    message: 'Reached 10,000 check-in limit',
                    offset
                });
                hasMore = false;
            }
            
            // If we got fewer than limit, we've reached the end
            if (items.length < limit) {
                hasMore = false;
            }
        }
        
        // Merge and dedupe: new check-ins take precedence (may have updated likes/comments)
        const existingById = new Map(existingCheckins.map(c => [c.id, c]));
        for (const checkin of newCheckins) {
            existingById.set(checkin.id, checkin); // Overwrites if exists
        }
        
        // Convert back to array and sort by timestamp (newest first)
        const mergedCheckins = Array.from(existingById.values())
            .sort((a, b) => b.timestamp - a.timestamp);
        
        // Generate stats
        const stats = {
            total: mergedCheckins.length,
            newFetched: newCheckins.length,
            previousCount: existingCheckins.length,
            uniqueVenues: [...new Set(mergedCheckins.map(c => c.venue.id))].length,
            withPhotos: mergedCheckins.filter(c => c.photos.length > 0).length,
            withShouts: mergedCheckins.filter(c => c.shout).length,
            categories: [...new Set(mergedCheckins.map(c => c.venue.category).filter(Boolean))].length,
            dateRange: mergedCheckins.length > 0 ? {
                oldest: mergedCheckins[mergedCheckins.length - 1].date,
                newest: mergedCheckins[0].date
            } : null
        };
        
        foursquareLogger.info('foursquare.harvest.success', { 
            username,
            guidId,
            mode: fullSync ? 'full' : 'incremental',
            ...stats
        });
        
        // Save merged data
        userSaveFile(username, 'checkins', mergedCheckins);
        
        return mergedCheckins;
        
    } catch (error) {
        const statusCode = error.response?.status;
        const errorDetail = error.response?.data?.meta?.errorDetail;
        
        if (statusCode === 401) {
            foursquareLogger.error('foursquare.auth.invalid', { 
                message: 'Foursquare OAuth token is invalid or expired',
                username,
                errorDetail
            });
            throw new Error('Foursquare OAuth token is invalid or expired');
        }
        
        if (statusCode === 403) {
            foursquareLogger.error('foursquare.auth.forbidden', { 
                message: 'Foursquare access forbidden - check token permissions',
                username,
                errorDetail
            });
            throw new Error('Foursquare access forbidden');
        }
        
        if (statusCode === 429) {
            foursquareLogger.error('foursquare.rate_limit', { 
                message: 'Foursquare API rate limit exceeded',
                username
            });
            throw new Error('Foursquare API rate limit exceeded');
        }
        
        foursquareLogger.error('foursquare.fetch.failed', { 
            error: error.message,
            statusCode,
            errorDetail,
            username
        });
        throw error;
    }
};

export default getFoursquareCheckins;
