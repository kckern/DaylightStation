#!/usr/bin/env node
/**
 * FitnessSyncer OAuth Token Exchange CLI
 * 
 * Usage:
 *   1. Go to: https://www.fitnesssyncer.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=YOUR_REDIRECT
 *   2. After authorization, copy the 'code' from the redirect URL
 *   3. Run: node cli/fitsync-auth.cli.mjs --code YOUR_CODE
 * 
 * This will exchange the code for tokens and save them to the user's auth file.
 */

import { fileURLToPath } from 'url';
import path from 'path';
import axios from 'axios';
import { getConfigService } from './_bootstrap.mjs';
import { DataService } from '#adapters/persistence/files/DataService.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Set up environment
process.chdir(projectRoot);

const configService = await getConfigService();
const dataService = new DataService({ configService });
const userLoadAuth = (username, service) => dataService.user.read(`auth/${service}`, username);
const userSaveAuth = (username, service, value) => dataService.user.write(`auth/${service}`, value, username);

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
};

const code = getArg('code');
const username = getArg('username') || configService.getHeadOfHousehold();

// Get existing auth to preserve client credentials
const existingAuth = userLoadAuth(username, 'fitnesssyncer') || {};
const clientId = getArg('client-id') || existingAuth.client_id || process.env.FITSYNC_CLIENT_ID;
const clientSecret = getArg('client-secret') || existingAuth.client_secret || process.env.FITSYNC_CLIENT_SECRET;
const redirectUri = getArg('redirect') || 'https://www.fitnesssyncer.com/';

const printUsage = () => {
    console.log(`
FitnessSyncer OAuth Token Exchange

Usage:
  node cli/fitsync-auth.cli.mjs --code <authorization_code>

Options:
  --code <code>           Authorization code from OAuth redirect (required for exchange)
  --username <username>   Target username (default: ${username})
  --client-id <id>        OAuth client ID (default: from auth file or env)
  --client-secret <secret> OAuth client secret (default: from auth file or env)
  --redirect <uri>        Redirect URI used in OAuth (default: ${redirectUri})

Steps:
  1. Visit the authorization URL:
     https://www.fitnesssyncer.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}

  2. Log in and authorize the app

  3. Copy the 'code' parameter from the redirect URL

  4. Run: node cli/fitsync-auth.cli.mjs --code <YOUR_CODE>

Current config:
  Username: ${username}
  Client ID: ${clientId ? clientId.substring(0, 8) + '...' : 'NOT SET'}
  Client Secret: ${clientSecret ? '***configured***' : 'NOT SET'}
  Auth file: data/users/${username}/auth/fitnesssyncer.yml
`);
};

const exchangeCodeForTokens = async (authCode) => {
    if (!clientId || !clientSecret) {
        console.error('❌ Missing client_id or client_secret');
        console.error('   Set them in the auth file or via --client-id and --client-secret');
        process.exit(1);
    }

    console.log(`\n🔄 Exchanging authorization code for tokens...`);
    console.log(`   Username: ${username}`);
    console.log(`   Client ID: ${clientId.substring(0, 8)}...`);

    try {
        const response = await axios.post(
            'https://www.fitnesssyncer.com/api/oauth/access_token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: authCode,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in } = response.data;

        if (!refresh_token) {
            console.error('❌ No refresh token in response');
            console.error('   Response:', JSON.stringify(response.data, null, 2));
            process.exit(1);
        }

        // Save tokens to auth file
        userSaveAuth(username, 'fitnesssyncer', {
            refresh: refresh_token,
            client_id: clientId,
            client_secret: clientSecret
        });

        console.log(`\n✅ Success! Tokens saved to auth file.`);
        console.log(`   Refresh token: ${refresh_token.substring(0, 16)}...`);
        console.log(`   Access token expires in: ${expires_in} seconds`);
        console.log(`\n   Auth file: data/users/${username}/auth/fitnesssyncer.yml`);
        console.log(`\n🎉 FitnessSyncer is now configured! Run the harvester to test.`);

    } catch (error) {
        console.error('❌ Token exchange failed');
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Error: ${error.response?.data?.error || error.message}`);
        
        if (error.response?.status === 400) {
            console.error('\n   Common causes:');
            console.error('   - Authorization code has expired (they expire quickly!)');
            console.error('   - Code was already used');
            console.error('   - Redirect URI mismatch');
        }
        
        process.exit(1);
    }
};

const refreshExistingToken = async () => {
    if (!existingAuth.refresh) {
        console.error('❌ No refresh token found in auth file');
        printUsage();
        process.exit(1);
    }

    console.log(`\n🔄 Testing token refresh...`);

    try {
        const response = await axios.post(
            'https://www.fitnesssyncer.com/api/oauth/access_token',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: existingAuth.refresh,
                client_id: clientId,
                client_secret: clientSecret
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_in } = response.data;

        if (refresh_token && refresh_token !== existingAuth.refresh) {
            userSaveAuth(username, 'fitnesssyncer', {
                refresh: refresh_token,
                client_id: clientId,
                client_secret: clientSecret
            });
            console.log(`✅ New refresh token saved!`);
        }

        console.log(`✅ Token refresh successful!`);
        console.log(`   Access token expires in: ${expires_in} seconds`);

    } catch (error) {
        console.error('❌ Token refresh failed');
        console.error(`   Status: ${error.response?.status}`);
        console.error(`   Error: ${error.response?.data?.error || error.message}`);
        console.error('\n   The refresh token may have expired. Get a new authorization code.');
        printUsage();
        process.exit(1);
    }
};

// Main
if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
}

if (args.includes('--test')) {
    await refreshExistingToken();
} else if (code) {
    await exchangeCodeForTokens(code);
} else {
    printUsage();
}
