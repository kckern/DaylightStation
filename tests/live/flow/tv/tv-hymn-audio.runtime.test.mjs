/**
 * TV Hymn Audio Playback - Runtime Test
 *
 * Tests that hymn content loads text and audio correctly via /tv?hymn=1021
 *
 * This test verifies:
 * 1. The hymn API returns correct mediaUrl pointing to streaming endpoint
 * 2. The audio streaming endpoint returns valid audio content
 * 3. The TV page loads and plays hymn content without errors
 */
import { test, expect } from '@playwright/test';

// Use backend URL for all tests - it proxies frontend in dev mode
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3111';
const API_URL = process.env.TEST_API_URL || BASE_URL;

const HYMN_NUMBER = 1021;

test.describe('TV Hymn Audio Playback', () => {
  test.setTimeout(60000);

  test('Hymn API returns correct mediaUrl format', async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/local-content/hymn/${HYMN_NUMBER}`);
    expect(response.ok(), 'Hymn API should return 200').toBe(true);

    const data = await response.json();
    
    // Verify required fields
    expect(data.title).toBeTruthy();
    expect(data.number).toBe(HYMN_NUMBER);
    expect(data.hymn_num).toBe(HYMN_NUMBER);
    expect(data.verses).toBeDefined();
    expect(Array.isArray(data.verses)).toBe(true);
    expect(data.verses.length).toBeGreaterThan(0);
    
    // Verify mediaUrl uses the new streaming endpoint format
    expect(data.mediaUrl).toBe(`/api/v1/proxy/local-content/stream/hymn/${HYMN_NUMBER}`);
    expect(data.duration).toBeGreaterThan(0);
    
    console.log(`✅ Hymn ${HYMN_NUMBER}: "${data.title}" (${data.duration}s, ${data.verses.length} verses)`);
  });

  test('Audio streaming endpoint returns valid audio', async ({ request }) => {
    // Test HEAD request for audio metadata
    const headResponse = await request.head(`${API_URL}/api/v1/proxy/local-content/stream/hymn/${HYMN_NUMBER}`);
    expect(headResponse.ok(), 'Audio stream HEAD should return 200').toBe(true);
    
    const headers = headResponse.headers();
    expect(headers['content-type']).toBe('audio/mpeg');
    expect(parseInt(headers['content-length'])).toBeGreaterThan(0);
    
    console.log(`✅ Audio stream: ${headers['content-type']}, ${(parseInt(headers['content-length']) / 1024 / 1024).toFixed(2)} MB`);
  });

  test('Audio streaming endpoint supports range requests', async ({ request }) => {
    // Test range request for audio seeking
    const rangeResponse = await request.get(`${API_URL}/api/v1/proxy/local-content/stream/hymn/${HYMN_NUMBER}`, {
      headers: {
        'Range': 'bytes=0-1023'
      }
    });
    
    expect(rangeResponse.status(), 'Range request should return 206 Partial Content').toBe(206);
    
    const headers = rangeResponse.headers();
    expect(headers['content-range']).toMatch(/^bytes 0-1023\/\d+$/);
    expect(headers['accept-ranges']).toBe('bytes');
    
    console.log(`✅ Range request supported: ${headers['content-range']}`);
  });

  test('TV page loads hymn without audio errors', async ({ page }) => {
    const errors = [];
    const audioRequests = [];
    
    // Capture console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Track network errors
    page.on('response', response => {
      const url = response.url();
      if (url.includes('local-content') || url.includes('hymn')) {
        audioRequests.push({
          url,
          status: response.status(),
          ok: response.ok()
        });
      }
    });
    
    // Navigate to hymn
    await page.goto(`${BASE_URL}/tv?hymn=${HYMN_NUMBER}`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Wait for content to load
    await page.waitForTimeout(3000);
    
    // Check for audio-related errors
    const audioErrors = errors.filter(e => 
      e.toLowerCase().includes('audio') || 
      e.toLowerCase().includes('media') ||
      e.toLowerCase().includes('500') ||
      e.toLowerCase().includes('404')
    );
    
    // Log all requests for debugging
    console.log('\n📡 Audio-related requests:');
    for (const req of audioRequests) {
      const icon = req.ok ? '✅' : '❌';
      console.log(`  ${icon} ${req.status}: ${req.url}`);
    }
    
    // Verify no 500 errors on audio requests
    const failedRequests = audioRequests.filter(r => !r.ok);
    expect(failedRequests.length, `Audio requests should not fail: ${JSON.stringify(failedRequests)}`).toBe(0);
    
    // Check for audio element or player
    const hasAudioElement = await page.locator('audio').count() > 0;
    const hasPlayer = await page.locator('.single-player, .video-player, [class*="player"]').count() > 0;
    
    console.log(`\n🎵 Page state: hasAudio=${hasAudioElement}, hasPlayer=${hasPlayer}`);
    console.log(`❌ Audio errors: ${audioErrors.length > 0 ? audioErrors.join(', ') : 'none'}`);
    
    expect(hasAudioElement || hasPlayer, 'Page should have audio element or player').toBe(true);
    expect(audioErrors.length, `Should have no audio errors: ${audioErrors.join(', ')}`).toBe(0);
  });

  test('Multiple hymns can be streamed', async ({ request }) => {
    // Test a few different hymn numbers to ensure the prefix-based lookup works
    const hymnNumbers = [113, 304, 1004, 1021];
    
    for (const num of hymnNumbers) {
      const apiResponse = await request.get(`${API_URL}/api/v1/local-content/hymn/${num}`);
      if (!apiResponse.ok()) {
        console.log(`⚠️ Hymn ${num} not found (this may be expected)`);
        continue;
      }
      
      const data = await apiResponse.json();
      const streamResponse = await request.head(`${API_URL}${data.mediaUrl}`);
      
      if (streamResponse.ok()) {
        console.log(`✅ Hymn ${num}: "${data.title}" - audio streaming works`);
      } else {
        console.log(`❌ Hymn ${num}: "${data.title}" - audio stream failed (${streamResponse.status()})`);
        expect(streamResponse.ok(), `Audio stream for hymn ${num} should work`).toBe(true);
      }
    }
  });
});
