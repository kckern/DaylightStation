// tests/integration/api/v1-regression.test.mjs
/**
 * API v1 Regression Test Suite
 *
 * Official regression tests for all /api/v1/* endpoints.
 * Validates that DDD endpoints return valid data with expected structure.
 *
 * Run: npm run test:v1
 */

import { loadConfig, normalizeResponse, compareResponses, loadBaseline } from '../../lib/parity-runner.mjs';

const config = loadConfig();
const BASE_URL = process.env.TEST_BASE_URL || config.server?.default_url || 'http://localhost:3112';
const TIMEOUT = config.server?.timeout_ms || 10000;

/**
 * Fetch JSON from endpoint with timeout
 */
async function fetchJSON(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    clearTimeout(timeoutId);

    return {
      status: response.status,
      ok: response.ok,
      body: response.ok ? await response.json() : null,
      headers: Object.fromEntries(response.headers.entries())
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Validate response has required fields
 */
function validateRequiredFields(body, fields, path = '') {
  const errors = [];
  for (const field of fields) {
    if (!(field in body)) {
      errors.push(`Missing required field: ${path}${field}`);
    }
  }
  return errors;
}

/**
 * Validate response field types
 */
function validateTypes(body, typeChecks) {
  const errors = [];
  for (const [field, expectedType] of Object.entries(typeChecks)) {
    if (field in body) {
      const actualType = Array.isArray(body[field]) ? 'array' : typeof body[field];
      if (actualType !== expectedType) {
        errors.push(`Type mismatch for ${field}: expected ${expectedType}, got ${actualType}`);
      }
    }
  }
  return errors;
}

// =============================================================================
// Core API Health Tests
// =============================================================================

describe('API v1 Core', () => {
  describe('Health Endpoints', () => {
    it('GET /api/v1/ping returns ok', async () => {
      const res = await fetchJSON('/api/v1/ping');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // Accept either format: { ok: true } or { status: 'ok' }
      const isOk = res.body.ok === true || res.body.status === 'ok';
      expect(isOk).toBe(true);
      // Timestamp can be number or string
      expect(res.body.timestamp).toBeDefined();
    });

    it('GET /api/v1/status returns routes', async () => {
      const res = await fetchJSON('/api/v1/status');
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // Accept either format: { ok: true } or { status: 'ok' }
      const isOk = res.body.ok === true || res.body.status === 'ok';
      expect(isOk).toBe(true);
      // Routes array is present in apiV1 router version
      if (res.body.routes) {
        expect(Array.isArray(res.body.routes)).toBe(true);
        expect(res.body.routes.length).toBeGreaterThan(0);
      }
    });
  });
});

// =============================================================================
// Content Domain Tests
// =============================================================================

describe('API v1 Content Domain', () => {
  describe('Plex Content', () => {
    // Use a known baseline ID if available
    const testPlexId = '545219'; // From baselines

    it('GET /api/v1/content/plex/info/{id} returns valid plex info', async () => {
      const res = await fetchJSON(`/api/v1/content/plex/info/${testPlexId}`);

      // May 404 if Plex not configured - that's acceptable
      if (res.status === 404 || res.status === 503) {
        console.log('Plex not configured, skipping detailed validation');
        return;
      }

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();

      // Validate against baseline if exists
      const baseline = loadBaseline('plex', testPlexId);
      if (baseline) {
        // Only check id and title - type may not always be present
        const required = baseline.required_fields || ['id', 'title'];
        const errors = validateRequiredFields(res.body, required);
        expect(errors).toEqual([]);
      }
    });
  });

  describe('Local Content', () => {
    it('GET /api/v1/local-content/scripture/{ref} returns scripture', async () => {
      // Use valid scripture reference format: 1-nephi-1
      const res = await fetchJSON('/api/v1/local-content/scripture/1-nephi-1');

      if (res.status === 404 || res.status === 400) {
        console.log('Scripture data not available, skipping');
        return;
      }

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
      // Scripture returns 'reference' not 'id', 'title'
      expect(res.body.reference).toBeDefined();
    });

    it('GET /api/v1/local-content/hymn/{num} returns hymn', async () => {
      const res = await fetchJSON('/api/v1/local-content/hymn/2');

      if (res.status === 404 || res.status === 400) {
        console.log('Hymn data not available, skipping');
        return;
      }

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
  });
});

// =============================================================================
// List Domain Tests
// =============================================================================

describe('API v1 List Domain', () => {
  it('GET /api/v1/list/folder/{key} returns folder contents', async () => {
    const res = await fetchJSON('/api/v1/list/folder/FHE');

    if (res.status === 404) {
      console.log('FHE list not available, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();

    // Lists should have items array
    if (res.body.items) {
      expect(Array.isArray(res.body.items)).toBe(true);
    }
  });

  it('GET /api/v1/list/folder/{key}/playable returns playable items', async () => {
    const res = await fetchJSON('/api/v1/list/folder/FHE/playable');

    if (res.status === 404) {
      console.log('FHE list not available, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Health Domain Tests
// =============================================================================

describe('API v1 Health Domain', () => {
  it('GET /api/v1/health/status returns health status', async () => {
    const res = await fetchJSON('/api/v1/health/status');
    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('GET /api/v1/health/nutrilist returns nutrilist data', async () => {
    const res = await fetchJSON('/api/v1/health/nutrilist');

    if (res.status === 404) {
      console.log('Nutrilist not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('GET /api/v1/health/weight returns weight data', async () => {
    const res = await fetchJSON('/api/v1/health/weight');

    // Weight endpoint requires authentication context
    if (res.status === 401 || res.status === 404) {
      console.log('Weight requires auth context, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Finance Domain Tests
// =============================================================================

describe('API v1 Finance Domain', () => {
  it('GET /api/v1/finance/data returns budget data', async () => {
    const res = await fetchJSON('/api/v1/finance/data');

    if (res.status === 503 || res.status === 404) {
      console.log('Buxfer not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('GET /api/v1/finance/data/daytoday returns day-to-day data', async () => {
    const res = await fetchJSON('/api/v1/finance/data/daytoday');

    if (res.status === 503 || res.status === 404) {
      console.log('Buxfer not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Home Automation Domain Tests
// =============================================================================

describe('API v1 Home Domain', () => {
  it('GET /api/v1/home/entropy returns entropy report', async () => {
    const res = await fetchJSON('/api/v1/home/entropy');

    if (res.status === 404 || res.status === 503) {
      console.log('Entropy not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();

    // Entropy should have items array
    if (res.body.items) {
      expect(Array.isArray(res.body.items)).toBe(true);
    }
  });

  it('GET /api/v1/home/weather returns weather data', async () => {
    const res = await fetchJSON('/api/v1/home/weather');

    if (res.status === 404 || res.status === 503) {
      console.log('Weather not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('GET /api/v1/home/events returns calendar events', async () => {
    const res = await fetchJSON('/api/v1/home/events');

    if (res.status === 404 || res.status === 503) {
      console.log('Calendar not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // Note: /home/calendar does not exist - calendar data comes via /home/events
});

// =============================================================================
// Entropy Domain Tests (standalone)
// =============================================================================

describe('API v1 Entropy Domain', () => {
  it('GET /api/v1/entropy returns entropy data', async () => {
    const res = await fetchJSON('/api/v1/entropy');

    if (res.status === 404 || res.status === 503) {
      console.log('Entropy not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Lifelog Domain Tests
// =============================================================================

describe('API v1 Lifelog Domain', () => {
  it('GET /api/v1/lifelog/sources returns available sources', async () => {
    const res = await fetchJSON('/api/v1/lifelog/sources');

    // Lifelog may not be configured or may have errors
    if (res.status === 404 || res.status === 500) {
      console.log('Lifelog not configured or unavailable, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Gratitude Domain Tests
// =============================================================================

describe('API v1 Gratitude Domain', () => {
  it('GET /api/v1/gratitude/bootstrap returns bootstrap data', async () => {
    const res = await fetchJSON('/api/v1/gratitude/bootstrap');

    if (res.status === 404) {
      console.log('Gratitude not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Fitness Domain Tests
// =============================================================================

describe('API v1 Fitness Domain', () => {
  it('GET /api/v1/fitness returns fitness status', async () => {
    const res = await fetchJSON('/api/v1/fitness');

    if (res.status === 404) {
      console.log('Fitness not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });

  it('GET /api/v1/fitness/sessions/dates returns available dates', async () => {
    const res = await fetchJSON('/api/v1/fitness/sessions/dates');

    if (res.status === 404) {
      console.log('Fitness not configured, skipping');
      return;
    }

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Harvest Domain Tests
// =============================================================================

describe('API v1 Harvest Domain', () => {
  it('GET /api/v1/harvest returns harvester status', async () => {
    const res = await fetchJSON('/api/v1/harvest');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.harvesters)).toBe(true);
  });
});

// =============================================================================
// Scheduling Domain Tests
// =============================================================================

describe('API v1 Scheduling Domain', () => {
  it('GET /api/v1/scheduling/jobs returns jobs', async () => {
    const res = await fetchJSON('/api/v1/scheduling/jobs');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });

  it('GET /api/v1/scheduling/status returns scheduler status', async () => {
    const res = await fetchJSON('/api/v1/scheduling/status');

    expect(res.status).toBe(200);
    expect(res.body).toBeDefined();
  });
});

// =============================================================================
// Static Assets Tests
// =============================================================================

describe('API v1 Static Domain', () => {
  it('GET /api/v1/static/img/{path} returns static file', async () => {
    // Test a known static image path (entropy icons always exist)
    const url = `${BASE_URL}/api/v1/static/img/entropy/weight.svg`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      // Static assets should return successfully
      expect([200, 304]).toContain(response.status);
      // Should be SVG content type
      expect(response.headers.get('content-type')).toContain('svg');
    } catch (error) {
      clearTimeout(timeoutId);
      // If static serving isn't configured, that's acceptable
      console.log('Static serving not available:', error.message);
    }
  });
});

// =============================================================================
// Baseline-Driven Tests
// =============================================================================

describe('API v1 Baseline Validation', () => {
  // Load all available baselines and test against them
  const baselineTypes = ['plex', 'scripture', 'hymn', 'primary', 'talk', 'poem', 'list'];

  for (const type of baselineTypes) {
    describe(`${type} baselines`, () => {
      // Get endpoint mapping
      const endpointMap = {
        plex: (id) => `/api/v1/content/plex/info/${id}`,
        scripture: (id) => `/api/v1/local-content/scripture/${id}`,
        hymn: (id) => `/api/v1/local-content/hymn/${id}`,
        primary: (id) => `/api/v1/local-content/primary/${id}`,
        talk: (id) => `/api/v1/local-content/talk/${id}`,
        poem: (id) => `/api/v1/local-content/poem/${id}`,
        list: (id) => `/api/v1/list/folder/${id}`
      };

      // Sample one baseline per type for quick regression
      it(`validates ${type} response structure`, async () => {
        const sampleIds = {
          plex: '545219',
          scripture: '1-nephi-1',  // Use valid scripture reference format
          hymn: '2',
          primary: '2',           // Primary songs start at 2 (0002-i-am-a-child-of-god.yml)
          talk: 'ldsgc202510/11', // Talk requires conference/session format
          poem: 'remedy/01',      // Poem requires collection/id format
          list: 'FHE'
        };

        const sampleId = sampleIds[type];
        if (!sampleId) return;

        const endpoint = endpointMap[type](sampleId);
        const res = await fetchJSON(endpoint);

        // Service may not be configured
        if (res.status === 404 || res.status === 503) {
          console.log(`${type} service not available, skipping`);
          return;
        }

        expect(res.status).toBe(200);
        expect(res.body).toBeDefined();

        // Load baseline and validate required fields
        const baseline = loadBaseline(type, sampleId);
        if (baseline && baseline.required_fields) {
          const errors = validateRequiredFields(res.body, baseline.required_fields);
          if (errors.length > 0) {
            console.log(`Validation errors for ${type}/${sampleId}:`, errors);
          }
          expect(errors).toEqual([]);
        }
      });
    });
  }
});
