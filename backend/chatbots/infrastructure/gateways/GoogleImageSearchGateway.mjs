/**
 * Google Image Search Gateway
 * @module infrastructure/gateways/GoogleImageSearchGateway
 * 
 * Uses Google Custom Search API to find product images when UPC lookup doesn't provide one.
 * Requires GOOGLE_API_KEY and GOOGLE_CSE_ID in secrets.
 */

import { createLogger } from '../../_lib/logging/index.mjs';

const GOOGLE_CSE_API = 'https://www.googleapis.com/customsearch/v1';

/**
 * Google Image Search Gateway
 */
export class GoogleImageSearchGateway {
  #apiKey;
  #cseId;
  #logger;
  #timeout;

  /**
   * @param {Object} deps
   * @param {string} deps.apiKey - Google API key
   * @param {string} deps.cseId - Custom Search Engine ID
   * @param {Object} [deps.logger]
   * @param {number} [deps.timeout=5000] - Request timeout in ms
   */
  constructor(deps) {
    this.#apiKey = deps.apiKey;
    this.#cseId = deps.cseId;
    this.#logger = deps.logger || createLogger({ source: 'google-image-gateway', app: 'nutribot' });
    this.#timeout = deps.timeout || 5000;
  }

  /**
   * Check if the gateway is configured and ready to use
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.#apiKey && this.#cseId);
  }

  /**
   * Search for a product image
   * @param {string} query - Search query (product name, optionally with brand)
   * @param {Object} [options]
   * @param {string} [options.brand] - Brand name to include in search
   * @param {boolean} [options.foodOnly=true] - Restrict to food-related images
   * @returns {Promise<string|null>} Image URL or null if not found
   */
  async searchProductImage(query, options = {}) {
    if (!this.isConfigured()) {
      this.#logger.debug('imageSearch.notConfigured', { query });
      return null;
    }

    const { brand, foodOnly = true } = options;
    
    // Build search query
    let searchQuery = query;
    if (brand && !query.toLowerCase().includes(brand.toLowerCase())) {
      searchQuery = `${brand} ${query}`;
    }
    if (foodOnly) {
      searchQuery += ' food product';
    }

    this.#logger.debug('imageSearch.start', { searchQuery, originalQuery: query });

    try {
      const params = new URLSearchParams({
        key: this.#apiKey,
        cx: this.#cseId,
        q: searchQuery,
        searchType: 'image',
        num: '3', // Get a few results to pick from
        safe: 'active',
        imgSize: 'medium', // Medium size is good for chat displays
        imgType: 'photo',
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.#timeout);

      const response = await fetch(`${GOOGLE_CSE_API}?${params}`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.#logger.warn('imageSearch.httpError', { 
          searchQuery, 
          status: response.status,
          error: errorText.substring(0, 200),
        });
        return null;
      }

      const data = await response.json();

      if (!data.items || data.items.length === 0) {
        this.#logger.debug('imageSearch.noResults', { searchQuery });
        return null;
      }

      // Pick the best image from results
      const imageUrl = this.#selectBestImage(data.items);
      
      this.#logger.info('imageSearch.found', { 
        searchQuery, 
        imageUrl: imageUrl?.substring(0, 100),
        resultsCount: data.items.length,
      });

      return imageUrl;

    } catch (error) {
      if (error.name === 'AbortError') {
        this.#logger.warn('imageSearch.timeout', { searchQuery, timeout: this.#timeout });
      } else {
        this.#logger.error('imageSearch.error', { 
          searchQuery, 
          error: error.message,
          code: error.code,
        });
      }
      return null;
    }
  }

  /**
   * Select the best image from search results
   * Prefers images from known food/product sites and reasonable sizes
   * @private
   */
  #selectBestImage(items) {
    // Preferred domains for food product images
    const preferredDomains = [
      'target.com',
      'walmart.com',
      'amazon.com',
      'kroger.com',
      'instacart.com',
      'wholefoodsmarket.com',
      'safeway.com',
      'costco.com',
      'traderjoes.com',
      'albertsons.com',
    ];

    // Score each result
    const scored = items.map((item) => {
      let score = 0;
      const url = item.link || '';
      const domain = this.#extractDomain(url);

      // Prefer known food retailers
      if (preferredDomains.some(d => domain.includes(d))) {
        score += 10;
      }

      // Prefer images with reasonable dimensions
      const width = item.image?.width || 0;
      const height = item.image?.height || 0;
      if (width >= 200 && width <= 1000 && height >= 200 && height <= 1000) {
        score += 5;
      }

      // Avoid tiny images
      if (width < 100 || height < 100) {
        score -= 10;
      }

      // Prefer HTTPS
      if (url.startsWith('https://')) {
        score += 2;
      }

      // Avoid certain patterns that indicate bad images
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes('logo') || lowerUrl.includes('icon') || lowerUrl.includes('banner')) {
        score -= 5;
      }

      return { url: item.link, score };
    });

    // Sort by score descending and return best
    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.url || items[0]?.link || null;
  }

  /**
   * Extract domain from URL
   * @private
   */
  #extractDomain(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}

export default GoogleImageSearchGateway;
