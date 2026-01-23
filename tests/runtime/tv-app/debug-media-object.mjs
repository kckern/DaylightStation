/**
 * Quick debug test to inspect the media object structure in AudioPlayer
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3111';

(async () => {
  console.log(`\n🔍 Inspecting media object in AudioPlayer\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Navigate
  await page.goto(`${BASE_URL}/tv?play=154382`, { 
    waitUntil: 'networkidle', 
    timeout: 60000 
  });

  await page.waitForTimeout(3000);

  // Inject script to inspect the React component props
  const mediaData = await page.evaluate(() => {
    // Find the audio element
    const audioEl = document.querySelector('audio');
    if (!audioEl) return { error: 'No audio element found' };

    // Try to find React fiber to access props
    const fiberKey = Object.keys(audioEl).find(key => key.startsWith('__reactFiber'));
    if (!fiberKey) return { error: 'No React fiber found' };

    let fiber = audioEl[fiberKey];
    
    // Walk up to find AudioPlayer component
    while (fiber) {
      if (fiber.type?.name === 'AudioPlayer' || fiber.memoizedProps?.media) {
        return {
          media: fiber.memoizedProps?.media,
          componentName: fiber.type?.name
        };
      }
      fiber = fiber.return;
    }

    return { error: 'Could not find AudioPlayer component' };
  });

  console.log('Media object structure:');
  console.log(JSON.stringify(mediaData, null, 2));

  await page.waitForTimeout(10000);
  await browser.close();
})().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  process.exit(1);
});
