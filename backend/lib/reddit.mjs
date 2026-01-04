/**
 * Reddit Activity Harvester
 * 
 * Fetches user's Reddit post and comment history.
 * Auth: User-level username in data/users/{username}/auth/reddit.yml
 * 
 * Required auth file structure:
 *   username: <reddit_username>
 * 
 * Note: Uses Reddit's public JSON API (no OAuth required for public data)
 */

import axios from './http.mjs';
import moment from 'moment-timezone';
import { userSaveFile, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';

const redditLogger = createLogger({ source: 'backend', app: 'reddit' });

/**
 * Fetch user's Reddit activity (posts and comments)
 * @param {string} guidId - Request ID for logging
 * @param {object} req - Express request object (optional)
 * @returns {Promise<Array>} Array of Reddit activities
 */
const getRedditActivity = async (guidId = null, req = null) => {
    const targetUsername = req?.targetUsername;
    const username = targetUsername || getDefaultUsername();
    const auth = configService.getUserAuth('reddit', username) || {};
    
    const REDDIT_USERNAME = auth.username;
    
    if (!REDDIT_USERNAME) {
        redditLogger.error('reddit.auth.missing', { 
            message: 'No Reddit username found in auth file',
            username,
            suggestion: 'Create data/users/{username}/auth/reddit.yml with username field'
        });
        throw new Error('Reddit username not configured');
    }
    
    try {
        const activities = [];
        const requestHeaders = { 'User-Agent': 'DaylightStation-Harvester/1.0' };
        
        // Fetch user's posts (submissions)
        const postsResponse = await axios.get(
            `https://www.reddit.com/user/${REDDIT_USERNAME}/submitted.json`,
            { params: { limit: 100 }, headers: requestHeaders }
        );
        
        const posts = postsResponse.data?.data?.children || [];
        posts.forEach(post => {
            const data = post.data;
            activities.push({
                id: data.id,
                type: 'post',
                subreddit: data.subreddit,
                title: data.title,
                url: `https://reddit.com${data.permalink}`,
                selftext: data.selftext || null,
                score: data.score,
                upvoteRatio: data.upvote_ratio,
                numComments: data.num_comments,
                createdAt: moment.unix(data.created_utc).toISOString(),
                date: moment.unix(data.created_utc).format('YYYY-MM-DD'),
                timestamp: data.created_utc,
                isNsfw: data.over_18,
                linkUrl: data.is_self ? null : data.url
            });
        });
        
        // Fetch user's comments
        const commentsResponse = await axios.get(
            `https://www.reddit.com/user/${REDDIT_USERNAME}/comments.json`,
            { params: { limit: 100 }, headers: requestHeaders }
        );
        
        const comments = commentsResponse.data?.data?.children || [];
        comments.forEach(comment => {
            const data = comment.data;
            activities.push({
                id: data.id,
                type: 'comment',
                subreddit: data.subreddit,
                body: data.body,
                url: `https://reddit.com${data.permalink}`,
                score: data.score,
                parentId: data.parent_id,
                linkTitle: data.link_title,
                createdAt: moment.unix(data.created_utc).toISOString(),
                date: moment.unix(data.created_utc).format('YYYY-MM-DD'),
                timestamp: data.created_utc,
                isNsfw: data.over_18
            });
        });
        
        // Fetch user's upvoted posts (public only - requires user to have public votes)
        try {
            const upvotedResponse = await axios.get(
                `https://www.reddit.com/user/${REDDIT_USERNAME}/upvoted.json`,
                { params: { limit: 100 }, headers: requestHeaders }
            );
            
            const upvoted = upvotedResponse.data?.data?.children || [];
            upvoted.forEach(item => {
                const data = item.data;
                activities.push({
                    id: `upvote_${data.id}`,
                    type: 'upvote',
                    subreddit: data.subreddit,
                    title: data.title,
                    url: `https://reddit.com${data.permalink}`,
                    author: data.author,
                    score: data.score,
                    createdAt: moment.unix(data.created_utc).toISOString(),
                    date: moment.unix(data.created_utc).format('YYYY-MM-DD'),
                    timestamp: data.created_utc,
                    isNsfw: data.over_18
                });
            });
        } catch (upvoteError) {
            // Upvotes may be private - that's okay
            redditLogger.debug('reddit.upvotes.private', { 
                message: 'Upvotes not accessible (may be private)',
                username: REDDIT_USERNAME
            });
        }
        
        // Fetch user's saved posts (public only - requires user to have public saves)
        try {
            const savedResponse = await axios.get(
                `https://www.reddit.com/user/${REDDIT_USERNAME}/saved.json`,
                { params: { limit: 100 }, headers: requestHeaders }
            );
            
            const saved = savedResponse.data?.data?.children || [];
            saved.forEach(item => {
                const data = item.data;
                activities.push({
                    id: `saved_${data.id}`,
                    type: 'saved',
                    subreddit: data.subreddit,
                    title: data.title || data.link_title,
                    body: data.body || null,
                    url: `https://reddit.com${data.permalink}`,
                    author: data.author,
                    score: data.score,
                    createdAt: moment.unix(data.created_utc).toISOString(),
                    date: moment.unix(data.created_utc).format('YYYY-MM-DD'),
                    timestamp: data.created_utc,
                    isNsfw: data.over_18
                });
            });
        } catch (savedError) {
            // Saved posts may be private - that's okay
            redditLogger.debug('reddit.saved.private', { 
                message: 'Saved posts not accessible (may be private)',
                username: REDDIT_USERNAME
            });
        }
        
        // Sort by timestamp descending
        activities.sort((a, b) => b.timestamp - a.timestamp);
        
        const stats = {
            total: activities.length,
            posts: activities.filter(a => a.type === 'post').length,
            comments: activities.filter(a => a.type === 'comment').length,
            upvotes: activities.filter(a => a.type === 'upvote').length,
            saved: activities.filter(a => a.type === 'saved').length,
            subreddits: [...new Set(activities.map(a => a.subreddit))].length
        };
        
        redditLogger.info('reddit.harvest.success', { 
            username: REDDIT_USERNAME,
            ...stats
        });
        
        userSaveFile(username, 'reddit', activities);
        return activities;
        
    } catch (error) {
        const statusCode = error.response?.status;
        
        if (statusCode === 404) {
            redditLogger.error('reddit.user.not_found', { 
                redditUsername: REDDIT_USERNAME,
                username
            });
            throw new Error(`Reddit user '${REDDIT_USERNAME}' not found`);
        }
        
        if (statusCode === 429) {
            redditLogger.error('reddit.rate_limit', { 
                message: 'Reddit API rate limit exceeded',
                username
            });
            throw new Error('Reddit API rate limit exceeded');
        }
        
        redditLogger.error('reddit.fetch.failed', { 
            error: error.message,
            statusCode,
            username
        });
        throw error;
    }
};

export default getRedditActivity;
