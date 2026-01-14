/**
 * Withings Token Exchange Unit Test
 * 
 * Run with: npm test -- tests/unit/withings-auth.test.mjs
 */

import axios from 'axios';

describe('Withings Token Exchange', () => {
  const WITHINGS_CLIENT_ID = process.env.WITHINGS_CLIENT_ID;
  const WITHINGS_CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET;
  const WITHINGS_REDIRECT = process.env.WITHINGS_REDIRECT || 'http://localhost:3112/auth/withings/callback';
  
  const REFRESH_TOKEN = 'REDACTED_TOKEN';

  it('live test: exchanges refresh token for access token', async () => {
    if (!WITHINGS_CLIENT_ID || !WITHINGS_CLIENT_SECRET) {
      console.log('⏭️  Skipping - WITHINGS_CLIENT_ID or WITHINGS_CLIENT_SECRET not set');
      return;
    }
    
    const params = {
      action: 'requesttoken',
      grant_type: 'refresh_token',
      client_id: WITHINGS_CLIENT_ID,
      client_secret: WITHINGS_CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      redirect_uri: WITHINGS_REDIRECT
    };
    
    console.log('\n🔄 Testing token exchange with Withings API...');
    console.log('   Client ID:', WITHINGS_CLIENT_ID?.substring(0, 15) + '...');
    console.log('   Refresh token:', REFRESH_TOKEN.substring(0, 15) + '...');
    
    try {
      const response = await axios.post('https://wbsapi.withings.net/v2/oauth2', params);
      const body = response.data.body;
      
      console.log('\n✅ Token exchange successful!');
      console.log('   Status:', response.data.status);
      console.log('   Access token:', body.access_token ? body.access_token.substring(0, 25) + '...' : '❌ MISSING');
      console.log('   Refresh token:', body.refresh_token ? body.refresh_token.substring(0, 25) + '...' : '(not provided - using existing)');
      console.log('   Expires in:', body.expires_in, 'seconds (' + Math.round(body.expires_in / 3600) + ' hours)');
      console.log('   User ID:', body.userid);
      
      expect(response.data.status).toBe(0);
      expect(body.access_token).toBeTruthy();
      expect(body.expires_in).toBeGreaterThan(0);
      expect(body.userid).toBeTruthy();
    } catch (error) {
      console.error('\n❌ Token exchange failed!');
      console.error('   Status:', error.response?.status);
      console.error('   Withings status code:', error.response?.data?.status);
      console.error('   Error:', error.response?.data?.error || error.message);
      
      if (error.response?.status === 401) {
        console.error('\n⚠️  The refresh token is invalid or expired.');
        console.error('   Action required: Re-authorize the Withings integration');
      }
      
      throw error;
    }
  }, 30000);
});
