/**
 * Update Strava Token Script
 * 
 * Usage: node scripts/update-strava-token.mjs <authorization_code>
 */

import { setupTestEnv } from '../chatbots/_lib/testing/setupTestEnv.mjs';
import { userSaveAuth, userLoadAuth } from '../lib/io.mjs';
import configService from '../lib/config/index.mjs';
import axios from '../lib/http.mjs';

// Setup environment to load secrets
setupTestEnv();

const code = process.argv[2];

if (!code) {
    console.error('❌ Missing authorization code.');
    console.error('Usage: node scripts/update-strava-token.mjs <authorization_code>');
    process.exit(1);
}

const updateToken = async () => {
    const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET } = process.env;
    
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
        console.error('❌ Missing Strava credentials in environment/config.');
        process.exit(1);
    }

    console.log('🔄 Exchanging code for tokens...');
    
    try {
        const response = await axios.post('https://www.strava.com/oauth/token', 
            new URLSearchParams({
                client_id: STRAVA_CLIENT_ID,
                client_secret: STRAVA_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code'
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { access_token, refresh_token, expires_at, athlete } = response.data;
        
        console.log('✅ Token exchange successful!');
        console.log(`   Athlete: ${athlete?.firstname} ${athlete?.lastname}`);
        
        const head = configService.getHeadOfHousehold();
        console.log(`   Saving to user: ${head}`);
        
        const authData = {
            access_token,
            refresh: refresh_token,
            expires_at,
            athlete_id: athlete?.id
        };
        
        userSaveAuth(head, 'strava', authData);
        
        console.log('💾 Saved new tokens to disk.');
        console.log('🎉 You can now run the test again: npm run test:strava:live');
        
    } catch (error) {
        console.error('❌ Token exchange failed:', error.response?.data || error.message);
        process.exit(1);
    }
};

updateToken();
