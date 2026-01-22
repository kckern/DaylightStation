/**
 * GoogleImageSearchGateway Unit Tests
 * 
 * Tests the Google Image Search gateway for product image fallback.
 * Uses mocked fetch responses - no actual API calls.
 */

import { jest } from '@jest/globals';

// Mock fetch globally before importing the gateway
const mockFetch = jest.fn();
global.fetch = mockFetch;

const { GoogleImageSearchGateway } = await import('#backend/_legacy/chatbots/infrastructure/gateways/GoogleImageSearchGateway.mjs');

describe('GoogleImageSearchGateway', () => {
  let gateway;
  const mockApiKey = 'test-api-key';
  const mockCseId = 'test-cse-id';

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new GoogleImageSearchGateway({
      apiKey: mockApiKey,
      cseId: mockCseId,
      timeout: 5000,
    });
  });

  describe('isConfigured', () => {
    it('returns true when both apiKey and cseId are provided', () => {
      expect(gateway.isConfigured()).toBe(true);
    });

    it('returns false when apiKey is missing', () => {
      const unconfigured = new GoogleImageSearchGateway({ cseId: mockCseId });
      expect(unconfigured.isConfigured()).toBe(false);
    });

    it('returns false when cseId is missing', () => {
      const unconfigured = new GoogleImageSearchGateway({ apiKey: mockApiKey });
      expect(unconfigured.isConfigured()).toBe(false);
    });

    it('returns false when both are missing', () => {
      const unconfigured = new GoogleImageSearchGateway({});
      expect(unconfigured.isConfigured()).toBe(false);
    });
  });

  describe('searchProductImage', () => {
    // Sample UPC: Cheerios cereal
    const sampleProduct = {
      name: 'Cheerios',
      brand: 'General Mills',
      upc: '016000275287',
    };

    it('returns image URL on successful search', async () => {
      const mockImageUrl = 'https://target.com/images/cheerios-box.jpg';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              link: mockImageUrl,
              image: { width: 400, height: 400 },
            },
          ],
        }),
      });

      const result = await gateway.searchProductImage(sampleProduct.name, {
        brand: sampleProduct.brand,
      });

      expect(result).toBe(mockImageUrl);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      
      // Verify search query includes product name and brand
      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('q=General+Mills+Cheerios');
      expect(calledUrl).toContain('searchType=image');
    });

    it('prefers images from known food retailers', async () => {
      const targetUrl = 'https://target.com/images/cheerios.jpg';
      const randomUrl = 'https://random-blog.com/cheerios.jpg';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { link: randomUrl, image: { width: 300, height: 300 } },
            { link: targetUrl, image: { width: 300, height: 300 } },
          ],
        }),
      });

      const result = await gateway.searchProductImage(sampleProduct.name);

      // Should prefer target.com over random-blog.com
      expect(result).toBe(targetUrl);
    });

    it('returns null when no results found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const result = await gateway.searchProductImage('nonexistent-product-xyz');

      expect(result).toBeNull();
    });

    it('returns null on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      const result = await gateway.searchProductImage(sampleProduct.name);

      expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await gateway.searchProductImage(sampleProduct.name);

      expect(result).toBeNull();
    });

    it('returns null when gateway is not configured', async () => {
      const unconfigured = new GoogleImageSearchGateway({});
      
      const result = await unconfigured.searchProductImage(sampleProduct.name);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('adds "food product" to search query by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ link: 'https://example.com/img.jpg' }] }),
      });

      await gateway.searchProductImage('Cheerios');

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).toContain('food+product');
    });

    it('skips "food product" suffix when foodOnly is false', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ link: 'https://example.com/img.jpg' }] }),
      });

      await gateway.searchProductImage('Cheerios', { foodOnly: false });

      const calledUrl = mockFetch.mock.calls[0][0];
      expect(calledUrl).not.toContain('food+product');
    });

    it('avoids duplicate brand in query when already in product name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ link: 'https://example.com/img.jpg' }] }),
      });

      await gateway.searchProductImage('General Mills Cheerios', {
        brand: 'General Mills',
      });

      const calledUrl = mockFetch.mock.calls[0][0];
      // Should not have "General Mills" twice
      const qParam = new URL(calledUrl).searchParams.get('q');
      const brandCount = (qParam.match(/General Mills/gi) || []).length;
      expect(brandCount).toBe(1);
    });
  });

  describe('image selection scoring', () => {
    it('prefers HTTPS over HTTP', async () => {
      const httpsUrl = 'https://example.com/image.jpg';
      const httpUrl = 'http://example.com/image.jpg';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { link: httpUrl, image: { width: 300, height: 300 } },
            { link: httpsUrl, image: { width: 300, height: 300 } },
          ],
        }),
      });

      const result = await gateway.searchProductImage('test');

      expect(result).toBe(httpsUrl);
    });

    it('avoids images with logo/icon/banner in URL', async () => {
      const goodUrl = 'https://example.com/product.jpg';
      const logoUrl = 'https://example.com/logo.jpg';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { link: logoUrl, image: { width: 300, height: 300 } },
            { link: goodUrl, image: { width: 300, height: 300 } },
          ],
        }),
      });

      const result = await gateway.searchProductImage('test');

      expect(result).toBe(goodUrl);
    });

    it('prefers reasonably sized images', async () => {
      const goodSizeUrl = 'https://example.com/good.jpg';
      const tinyUrl = 'https://example.com/tiny.jpg';
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { link: tinyUrl, image: { width: 50, height: 50 } },
            { link: goodSizeUrl, image: { width: 400, height: 400 } },
          ],
        }),
      });

      const result = await gateway.searchProductImage('test');

      expect(result).toBe(goodSizeUrl);
    });
  });

  describe('real UPC lookup scenarios (mocked)', () => {
    // Common grocery items with their UPCs for reference
    const testProducts = [
      { upc: '016000275287', name: 'Cheerios', brand: 'General Mills' },
      { upc: '038000138416', name: 'Frosted Flakes', brand: 'Kelloggs' },
      { upc: '041196010152', name: 'Greek Yogurt', brand: 'Chobani' },
      { upc: '012000001536', name: 'Mountain Dew', brand: 'PepsiCo' },
    ];

    it.each(testProducts)('searches for $name ($upc)', async ({ name, brand }) => {
      const expectedUrl = `https://target.com/images/${name.toLowerCase().replace(/\s+/g, '-')}.jpg`;
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ link: expectedUrl, image: { width: 400, height: 400 } }],
        }),
      });

      const result = await gateway.searchProductImage(name, { brand });

      expect(result).toBe(expectedUrl);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
