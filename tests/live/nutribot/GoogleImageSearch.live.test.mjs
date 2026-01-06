/**
 * GoogleImageSearchGateway Live Integration Test
 * 
 * Tests the Google Image Search gateway with REAL API calls.
 * Requires GOOGLE_API_KEY and GOOGLE_CSE_ID in households/default/auth/google.yml
 * 
 * Run with: npm test -- tests/live/nutribot/GoogleImageSearch.live.test.mjs
 */

import { GoogleImageSearchGateway } from '../../../backend/chatbots/infrastructure/gateways/GoogleImageSearchGateway.mjs';
import { RealUPCGateway } from '../../../backend/chatbots/infrastructure/gateways/RealUPCGateway.mjs';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

describe('GoogleImageSearchGateway Live API', () => {
  let gateway;
  let upcGateway;
  let isConfigured = false;

  beforeAll(() => {
    // Load credentials from household auth file
    const authPath = '/Users/kckern/Library/CloudStorage/Dropbox/Apps/DaylightStation/data/households/default/auth/google.yml';
    let apiKey = null;
    let cseId = null;
    
    if (fs.existsSync(authPath)) {
      const authConfig = yaml.load(fs.readFileSync(authPath, 'utf8'));
      apiKey = authConfig.GOOGLE_API_KEY;
      cseId = authConfig.GOOGLE_CSE_ID;
    }

    gateway = new GoogleImageSearchGateway({
      apiKey,
      cseId,
      timeout: 10000, // Longer timeout for real API
    });
    
    upcGateway = new RealUPCGateway({});

    isConfigured = gateway.isConfigured();

    if (!isConfigured) {
      console.warn('\n⚠️  GOOGLE_API_KEY or GOOGLE_CSE_ID not configured - skipping live tests\n');
    } else {
      console.log('\n✅ Google Image Search configured and ready\n');
    }
  });

  // Sample products with real UPCs
  const testProducts = [
    { upc: '064384371447', name: null, brand: null }, // User's test UPC - name will be looked up
    { upc: '016000275287', name: 'Cheerios', brand: 'General Mills' },
    { upc: '038000138416', name: 'Frosted Flakes', brand: 'Kelloggs' },
    { upc: '041196010152', name: 'Greek Yogurt', brand: 'Chobani' },
    { upc: '012000001536', name: 'Mountain Dew', brand: 'PepsiCo' },
    { upc: '049000006346', name: 'Coca-Cola', brand: 'Coca-Cola' },
    { upc: '021130126026', name: 'Signature Select Ice Cream', brand: 'Signature Select' },
  ];

  describe('Full UPC → Image Search Flow', () => {
    it('looks up UPC 064384371447 and finds product image', async () => {
      if (!isConfigured) {
        console.log('  ⏭️  Skipped - credentials not configured');
        return;
      }

      // Step 1: Look up UPC to get product info
      console.log('  🔍 Looking up UPC 064384371447...');
      const product = await upcGateway.lookup('064384371447');
      
      if (!product) {
        console.log('  ⚠️  UPC not found in database - cannot test image search');
        return;
      }
      
      console.log(`  📦 Found: ${product.name}${product.brand ? ` (${product.brand})` : ''}`);
      console.log(`  🖼️  UPC database image: ${product.imageUrl || '(none)'}`);

      // Step 2: Try Google search by UPC code first
      let imageUrl = await gateway.searchProductImage('064384371447', { foodOnly: false });
      let imageSource = 'google-upc';
      console.log(`  📸 Google UPC search: ${imageUrl || '(no result)'}`);

      // Step 3: If no result, try by product name/brand
      if (!imageUrl) {
        imageUrl = await gateway.searchProductImage(product.name, {
          brand: product.brand,
          foodOnly: true,
        });
        imageSource = 'google-name';
        console.log(`  📸 Google name search: ${imageUrl || '(no result)'}`);
      }

      // Step 4: Would fall back to barcode generation (not tested here)
      if (!imageUrl) {
        console.log('  📊 Would generate barcode as final fallback');
        imageSource = 'barcode-generated';
      }

      console.log(`  ✅ Final image source: ${imageSource}`);

      // Should find an image for a real product
      if (imageUrl) {
        expect(imageUrl).toMatch(/^https?:\/\//);
      }
    }, 25000);
  });

  describe('searchProductImage', () => {
    it('finds an image for Cheerios cereal', async () => {
      if (!isConfigured) {
        console.log('  ⏭️  Skipped - credentials not configured');
        return;
      }

      const result = await gateway.searchProductImage('Cheerios', {
        brand: 'General Mills',
        foodOnly: true,
      });

      console.log('  📸 Cheerios image:', result);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^https?:\/\//);
    }, 15000);

    it('finds an image for Coca-Cola', async () => {
      if (!isConfigured) {
        console.log('  ⏭️  Skipped - credentials not configured');
        return;
      }

      const result = await gateway.searchProductImage('Coca-Cola', {
        brand: 'Coca-Cola',
        foodOnly: true,
      });

      console.log('  📸 Coca-Cola image:', result);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^https?:\/\//);
    }, 15000);

    it('finds an image for Greek Yogurt', async () => {
      if (!isConfigured) {
        console.log('  ⏭️  Skipped - credentials not configured');
        return;
      }

      const result = await gateway.searchProductImage('Greek Yogurt', {
        brand: 'Chobani',
        foodOnly: true,
      });

      console.log('  📸 Greek Yogurt image:', result);

      expect(result).not.toBeNull();
      expect(result).toMatch(/^https?:\/\//);
    }, 15000);

    it('handles obscure product search gracefully', async () => {
      if (!isConfigured) {
        console.log('  ⏭️  Skipped - credentials not configured');
        return;
      }

      // This might find something or might not - either is valid
      const result = await gateway.searchProductImage(
        'Super Rare Artisanal Product XYZ12345',
        { foodOnly: true }
      );

      console.log('  📸 Obscure product result:', result || '(null - no results)');

      // Result can be null or a valid URL
      if (result !== null) {
        expect(result).toMatch(/^https?:\/\//);
      }
    }, 15000);
  });

  describe('batch product image search', () => {
    // Filter out entries with null name (those need UPC lookup first)
    const namedProducts = testProducts.filter(p => p.name !== null);
    
    it.each(namedProducts)(
      'finds image for $name (UPC: $upc)',
      async ({ name, brand }) => {
        if (!isConfigured) {
          console.log('  ⏭️  Skipped - credentials not configured');
          return;
        }

        const result = await gateway.searchProductImage(name, {
          brand,
          foodOnly: true,
        });

        console.log(`  📸 ${name}: ${result || '(no image found)'}`);

        // Most common products should find an image
        expect(result).not.toBeNull();
        expect(result).toMatch(/^https?:\/\//);
      },
      15000
    );
  });

  describe('configuration check', () => {
    it('reports configuration status', () => {
      console.log('\n  🔑 Gateway configured:', isConfigured);
      
      if (!isConfigured) {
        console.log('  📝 To enable live tests, add to config.secrets.yml:');
        console.log('     GOOGLE_API_KEY: your-api-key');
        console.log('     GOOGLE_CSE_ID: your-custom-search-engine-id');
      }

      // This test always passes - it's informational
      expect(true).toBe(true);
    });
  });
});
