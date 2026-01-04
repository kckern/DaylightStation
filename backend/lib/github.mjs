/**
 * GitHub Activity Harvester
 * 
 * Fetches commit history and activity for a GitHub user.
 * Auth: User-level personal access token in data/users/{username}/auth/github.yml
 * 
 * Required auth file structure:
 *   username: <github_username>
 *   token: <personal_access_token>  # optional, for private repos and higher rate limits
 */

import axios from './http.mjs';
import moment from 'moment-timezone';
import { userSaveFile, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';

const githubLogger = createLogger({ source: 'backend', app: 'github' });

/**
 * Fetch user's commit activity from GitHub
 * @param {string} guidId - Request ID for logging
 * @param {object} req - Express request object (optional)
 * @returns {Promise<Array>} Array of commit events
 */
const getGitHubActivity = async (guidId = null, req = null) => {
    const targetUsername = req?.targetUsername;
    const username = targetUsername || getDefaultUsername();
    const auth = configService.getUserAuth('github', username) || {};
    
    const GITHUB_USERNAME = auth.username;
    const GITHUB_TOKEN = auth.token; // Optional for public data
    
    if (!GITHUB_USERNAME) {
        githubLogger.error('github.auth.missing', { 
            message: 'No GitHub username found in auth file',
            username,
            suggestion: 'Create data/users/{username}/auth/github.yml with username field'
        });
        throw new Error('GitHub username not configured');
    }
    
    try {
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'DaylightStation-Harvester'
        };
        
        // Include token if available (increases rate limit and allows private repos)
        if (GITHUB_TOKEN) {
            headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
        }
        
        const activities = [];
        
        // Fetch user's repos to get commit history
        const reposResponse = await axios.get(
            `https://api.github.com/users/${GITHUB_USERNAME}/repos`,
            { 
                headers,
                params: { per_page: 100, sort: 'pushed', direction: 'desc' }
            }
        );
        
        // Get commits from recent repos (limit to top 10 most recently pushed)
        const recentRepos = reposResponse.data.slice(0, 10);
        
        for (const repo of recentRepos) {
            try {
                const commitsResponse = await axios.get(
                    `https://api.github.com/repos/${repo.full_name}/commits`,
                    {
                        headers,
                        params: { 
                            author: GITHUB_USERNAME,
                            per_page: 50,
                            since: moment().subtract(90, 'days').toISOString()
                        }
                    }
                );
                
                for (const commit of commitsResponse.data) {
                    activities.push({
                        id: commit.sha,
                        type: 'commit',
                        repo: repo.full_name,
                        sha: commit.sha.substring(0, 7),
                        message: commit.commit.message.split('\n')[0], // First line only
                        fullMessage: commit.commit.message,
                        createdAt: commit.commit.author.date,
                        date: moment(commit.commit.author.date).format('YYYY-MM-DD'),
                        timestamp: moment(commit.commit.author.date).unix(),
                        url: commit.html_url,
                        additions: commit.stats?.additions,
                        deletions: commit.stats?.deletions
                    });
                }
            } catch (repoError) {
                // Skip repos we can't access (private, etc.)
                githubLogger.debug('github.repo.skip', { 
                    repo: repo.full_name, 
                    error: repoError.message 
                });
            }
        }
        
        // Also fetch events for PRs, issues, etc.
        const eventsResponse = await axios.get(
            `https://api.github.com/users/${GITHUB_USERNAME}/events/public`,
            { 
                headers,
                params: { per_page: 100 }
            }
        );
        
        for (const event of eventsResponse.data) {
            const baseEvent = {
                id: event.id,
                repo: event.repo.name,
                createdAt: event.created_at,
                date: moment(event.created_at).format('YYYY-MM-DD'),
                timestamp: moment(event.created_at).unix()
            };
            
            switch (event.type) {
                case 'PullRequestEvent':
                    activities.push({
                        ...baseEvent,
                        type: 'pull_request',
                        action: event.payload.action,
                        prNumber: event.payload.pull_request?.number,
                        title: event.payload.pull_request?.title,
                        url: event.payload.pull_request?.html_url
                    });
                    break;
                
                case 'IssuesEvent':
                    activities.push({
                        ...baseEvent,
                        type: 'issue',
                        action: event.payload.action,
                        issueNumber: event.payload.issue?.number,
                        title: event.payload.issue?.title,
                        url: event.payload.issue?.html_url
                    });
                    break;
                
                case 'IssueCommentEvent':
                    activities.push({
                        ...baseEvent,
                        type: 'comment',
                        issueNumber: event.payload.issue?.number,
                        body: event.payload.comment?.body?.substring(0, 200),
                        url: event.payload.comment?.html_url
                    });
                    break;
                    
                case 'CreateEvent':
                    if (event.payload.ref_type === 'repository' || event.payload.ref_type === 'branch') {
                        activities.push({
                            ...baseEvent,
                            type: 'create',
                            refType: event.payload.ref_type,
                            ref: event.payload.ref
                        });
                    }
                    break;
            }
        }
        
        // Sort by timestamp and dedupe
        activities.sort((a, b) => b.timestamp - a.timestamp);
        
        // Dedupe by id
        const seen = new Set();
        const deduped = activities.filter(a => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
        });
        
        githubLogger.info('github.harvest.success', { 
            username: GITHUB_USERNAME,
            activityCount: deduped.length,
            types: [...new Set(deduped.map(a => a.type))]
        });
        
        userSaveFile(username, 'github', deduped);
        return deduped;
        
    } catch (error) {
        const statusCode = error.response?.status;
        
        if (statusCode === 404) {
            githubLogger.error('github.user.not_found', { 
                githubUsername: GITHUB_USERNAME,
                username
            });
            throw new Error(`GitHub user '${GITHUB_USERNAME}' not found`);
        }
        
        if (statusCode === 403) {
            githubLogger.error('github.rate_limit', { 
                message: 'GitHub API rate limit exceeded',
                suggestion: 'Add a personal access token to increase rate limit'
            });
            throw new Error('GitHub API rate limit exceeded');
        }
        
        githubLogger.error('github.fetch.failed', { 
            error: error.message,
            statusCode,
            username
        });
        throw error;
    }
};

export default getGitHubActivity;
