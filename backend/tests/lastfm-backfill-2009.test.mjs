/**
 * Last.fm Backfill to 2009 Test
 * 
 * This test runs a full backfill of Last.fm scrobbles back to 2009.
 * It uses incremental saves every 1000 scrobbles to handle the large volume.
 * 
 * Run with: npm test -- lastfm-backfill-2009.test.mjs
 */

import getScrobbles from '../lib/lastfm.mjs';

describe('Last.fm 2009 Backfill', () => {
  it('should backfill scrobbles to 2009 with incremental saves', async () => {
    console.log('\n🎵 Starting Last.fm backfill to 2009...\n');
    
    const req = {
      query: {
        backfill2009: 'true'
      }
    };
    
    const startTime = Date.now();
    
    try {
      const scrobbles = await getScrobbles('backfill-2009-test', req);
      
      const duration = Math.round((Date.now() - startTime) / 1000);
      
      console.log('\n✅ Backfill complete!\n');
      console.log(`   Total scrobbles: ${scrobbles.length}`);
      console.log(`   Duration: ${duration}s`);
      
      if (scrobbles.length > 0) {
        const oldest = scrobbles[scrobbles.length - 1];
        const newest = scrobbles[0];
        console.log(`   Oldest: ${oldest.date}`);
        console.log(`   Newest: ${newest.date}`);
      }
      
      expect(scrobbles).toBeDefined();
      expect(Array.isArray(scrobbles)).toBe(true);
      expect(scrobbles.length).toBeGreaterThan(0);
      
    } catch (error) {
      console.error('\n❌ Backfill failed:', error.message);
      throw error;
    }
  }, 600000); // 10 minute timeout
});
