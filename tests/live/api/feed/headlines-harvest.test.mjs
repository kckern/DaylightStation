/**
 * Headlines Harvest & Parsing Test
 *
 * Triggers a full headline harvest, then verifies that item descriptions
 * are clean text free of HTML/CSS artifacts (e.g. Tailwind class names,
 * Reddit boilerplate).
 */

const BACKEND_PORT = process.env.BACKEND_PORT || 3112;
const BASE_URL = `http://localhost:${BACKEND_PORT}/api/v1`;

async function fetchJson(endpoint, method = 'GET', timeoutMs = 10000) {
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

describe('Headlines Harvest & Parsing', () => {
  let pages;

  beforeAll(async () => {
    pages = await fetchJson('/feed/headlines/pages');
    console.log(`[Discovery] ${pages.length} headline page(s):`, pages.map(p => p.id));
  });

  it('backend should be reachable', async () => {
    const health = await fetchJson('/health');
    expect(health.ok).toBe(true);
  });

  it('should have at least one headline page', () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  it('should harvest headlines without error', async () => {
    // Harvest can take a while — give it 120s
    const result = await fetchJson('/feed/headlines/harvest', 'POST', 120000);
    expect(result).toBeDefined();

    console.log(`[Harvest] ${result.harvested} sources harvested, ${result.errors} errors, ${result.totalItems} total items`);

    expect(result.harvested).toBeGreaterThan(0);
    expect(result.totalItems).toBeGreaterThan(0);
  }, 130000);

  it('item descriptions should not contain CSS class artifacts', async () => {
    const pageId = pages[0]?.id;
    const data = await fetchJson(`/feed/headlines?page=${pageId}`);
    const sources = data?.sources || {};

    let totalItems = 0;
    const violations = [];

    for (const [sourceId, source] of Object.entries(sources)) {
      for (const item of source.items || []) {
        totalItems++;
        const desc = item.desc || '';

        // Tailwind bracket-notation class leakage
        if (/\[&[>\s]/.test(desc)) {
          violations.push({ source: sourceId, title: item.title, issue: 'tailwind classes', fragment: desc.substring(0, 80) });
        }

        // Raw HTML tags that should have been stripped
        if (/<[a-z][^>]*>/i.test(desc)) {
          violations.push({ source: sourceId, title: item.title, issue: 'raw HTML', fragment: desc.substring(0, 80) });
        }
      }
    }

    console.log(`[Parsing] Checked ${totalItems} items across ${Object.keys(sources).length} sources`);

    if (violations.length > 0) {
      console.error('[Parsing] Violations:', JSON.stringify(violations, null, 2));
    }

    expect(violations).toEqual([]);
  });

  it('item descriptions should be <= 123 characters (120 + ellipsis)', async () => {
    const pageId = pages[0]?.id;
    const data = await fetchJson(`/feed/headlines?page=${pageId}`);
    const sources = data?.sources || {};

    const overlong = [];

    for (const [sourceId, source] of Object.entries(sources)) {
      for (const item of source.items || []) {
        const desc = item.desc || '';
        if (desc.length > 123) {
          overlong.push({ source: sourceId, title: item.title, len: desc.length });
        }
      }
    }

    if (overlong.length > 0) {
      console.error('[Length] Overlong descriptions:', JSON.stringify(overlong, null, 2));
    }

    expect(overlong).toEqual([]);
  });

  it('item titles should be clean text', async () => {
    const pageId = pages[0]?.id;
    const data = await fetchJson(`/feed/headlines?page=${pageId}`);
    const sources = data?.sources || {};

    const violations = [];

    for (const [sourceId, source] of Object.entries(sources)) {
      for (const item of source.items || []) {
        const title = item.title || '';

        if (/<[a-z][^>]*>/i.test(title)) {
          violations.push({ source: sourceId, title, issue: 'contains HTML' });
        }

        if (!title.trim()) {
          violations.push({ source: sourceId, title: '(empty)', issue: 'empty title' });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
