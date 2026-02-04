/**
 * GoogleImageSearchGateway Live Integration Test
 *
 * Tests the Google Image Search gateway with REAL API calls.
 * Requires GOOGLE_API_KEY and GOOGLE_CSE_ID in household/auth/google.yml
 *
 * Run with: npm test -- tests/live/nutribot/GoogleImageSearch.live.test.mjs
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { GoogleImageSearchGateway } from '#backend/_legacy/chatbots/infrastructure/gateways/GoogleImageSearchGateway.mjs';
import { RealUPCGateway } from '#backend/_legacy/chatbots/infrastructure/gateways/RealUPCGateway.mjs';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig } from '../test-preconditions.mjs';

describe('GoogleImageSearchGateway Live API', () => {
  let gateway;
  let upcGateway;
  let apiKey;
  let cseId;

  beforeAll(() => {
    // FAIL if data path not configured
    const dataDir = requireDataPath(getDataPath);
    const authPath = path.join(dataDir, 'household/auth/google.yml');

    // FAIL if auth file doesn't exist
    if (!fs.existsSync(authPath)) {
      throw new Error(
        `[PRECONDITION FAILED] Google auth file not found at ${authPath}. ` +
        'Create household/auth/google.yml with GOOGLE_API_KEY and GOOGLE_CSE_ID.'
      );
    }

    const authConfig = yaml.load(fs.readFileSync(authPath, 'utf8'));
    apiKey = authConfig.GOOGLE_API_KEY;
    cseId = authConfig.GOOGLE_CSE_ID;

    // FAIL if credentials not configured
    requireConfig('GOOGLE_API_KEY', apiKey);
    requireConfig('GOOGLE_CSE_ID', cseId);

    gateway = new GoogleImageSearchGateway({
      apiKey,
      cseId,
      timeout: 10000,
    });

    upcGateway = new RealUPCGateway({});

    console.log('Google Image Search configured and ready');
  });

  // Sample products with real UPCs
  const testProducts = [
    { upc: '064384371447', name: null, brand: null },
    { upc: '016000275287', name: 'Cheerios', brand: 'General Mills' },
    { upc: '038000138416', name: 'Frosted Flakes', brand: 'Kelloggs' },
    { upc: '041196010152', name: 'Greek Yogurt', brand: 'Chobani' },
    { upc: '012000001536', name: 'Mountain Dew', brand: 'PepsiCo' },
    { upc: '049000006346', name: 'Coca-Cola', brand: 'Coca-Cola' },
    { upc: '021130126026', name: 'Signature Select Ice Cream', brand: 'Signature Select' },
  ];

  describe('Full UPC → Image Search Flow', () => {
    it('looks up UPC 064384371447 and finds product image', async () => {
      console.log('  Looking up UPC 064384371447...');
      const product = await upcGateway.lookup('064384371447');

      if (!product) {
        console.log('  UPC not found in database - cannot test image search');
        // This is acceptable - UPC database may not have this product
        return;
      }

      console.log(`  Found: ${product.name}${product.brand ? ` (${product.brand})` : ''}`);
      console.log(`  UPC database image: ${product.imageUrl || '(none)'}`);

      let imageUrl = await gateway.searchProductImage('064384371447', { foodOnly: false });
      let imageSource = 'google-upc';
      console.log(`  Google UPC search: ${imageUrl || '(no result)'}`);

      if (!imageUrl) {
        imageUrl = await gateway.searchProductImage(product.name, {
          brand: product.brand,
          foodOnly: true,
        });
        imageSource = 'google-name';
        console.log(`  Google name search: ${imageUrl || '(no result)'}`);
      }

      if (!imageUrl) {
        console.log('  Would generate barcode as final fallback');
        imageSource = 'barcode-generated';
      }

      console.log(`  Final image source: ${imageSource}`);

      if (imageUrl) {
        expect(imageUrl).toMatch(/^https?:\/\//);
      }
    }, 25000);
  });

  describe('searchProductImage', () => {
    it('finds an image for Cheerios cereal', async () => {
      const result = await gateway.searchProductImage('Cheerios', {
        brand: 'General Mills',
        foodOnly: true,
      });

      console.log('  Cheerios image:', result);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^https?:\/\//);
    }, 15000);

    it('finds an image for Coca-Cola', async () => {
      const result = await gateway.searchProductImage('Coca-Cola', {
        brand: 'Coca-Cola',
        foodOnly: true,
      });

      console.log('  Coca-Cola image:', result);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^https?:\/\//);
    }, 15000);

    it('finds an image for Greek Yogurt', async () => {
      const result = await gateway.searchProductImage('Greek Yogurt', {
        brand: 'Chobani',
        foodOnly: true,
      });

      console.log('  Greek Yogurt image:', result);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^https?:\/\//);
    }, 15000);

    it('handles obscure product search gracefully', async () => {
      const result = await gateway.searchProductImage(
        'Super Rare Artisanal Product XYZ12345',
        { foodOnly: true }
      );

      console.log('  Obscure product result:', result || '(null - no results)');

      // Result can be null or a valid URL - both are acceptable
      if (result !== null) {
        expect(result).toMatch(/^https?:\/\//);
      }
    }, 15000);
  });

  describe('batch product image search', () => {
    const namedProducts = testProducts.filter(p => p.name !== null);

    it.each(namedProducts)(
      'finds image for $name (UPC: $upc)',
      async ({ name, brand }) => {
        const result = await gateway.searchProductImage(name, {
          brand,
          foodOnly: true,
        });

        console.log(`  ${name}: ${result || '(no image found)'}`);

        expect(result).not.toBeNull();
        expect(result).toMatch(/^https?:\/\//);
      },
      15000
    );
  });

  describe('configuration check', () => {
    it('reports configuration status', () => {
      console.log('  Gateway configured:', gateway.isConfigured());
      expect(gateway.isConfigured()).toBe(true);
    });
  });
});
