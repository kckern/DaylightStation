// tests/live/api/admin/content.test.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Get the base URL from the test config or environment
const getBaseUrl = () => {
  return process.env.API_BASE_URL || 'http://localhost:3112';
};

const API_BASE = '/api/v1/admin/content';
const TEST_FOLDER = 'test-folder-' + Date.now();

async function apiCall(path, data = null, method = 'GET') {
  const url = `${getBaseUrl()}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (data && method !== 'GET') {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

describe('Admin Content API', () => {
  beforeAll(async () => {
    // Clean up any existing test folder
    try {
      await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER}`, { method: 'DELETE' });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  afterAll(async () => {
    // Clean up test folder
    try {
      await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER}`, { method: 'DELETE' });
    } catch (e) {
      // Ignore
    }
  });

  describe('Folders', () => {
    it('GET /lists should return folders array', async () => {
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists`);
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result).toHaveProperty('folders');
      expect(Array.isArray(result.folders)).toBe(true);
    });

    it('POST /lists should create folder', async () => {
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: TEST_FOLDER })
      });
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(result.folder).toBe(TEST_FOLDER.toLowerCase());
    });

    it('POST /lists should reject duplicate folder', async () => {
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: TEST_FOLDER })
      });
      expect(response.ok).toBe(false);
    });

    it('GET /lists/:folder should return items', async () => {
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`);
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result).toHaveProperty('items');
      expect(result.items).toEqual([]);
    });
  });

  describe('Items', () => {
    it('POST /lists/:folder/items should add item', async () => {
      const item = { label: 'Test Item', input: 'plex:123', action: 'Play' };
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(result.index).toBe(0);
    });

    it('PUT /lists/:folder/items/:index should update item', async () => {
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items/0`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Updated Item' })
      });
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.ok).toBe(true);
    });

    it('DELETE /lists/:folder/items/:index should remove item', async () => {
      const response = await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items/0`, {
        method: 'DELETE'
      });
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(result.deleted.label).toBe('Updated Item');
    });
  });

  describe('Reorder', () => {
    it('PUT /lists/:folder should reorder items', async () => {
      // Add multiple items
      await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Item A', input: 'plex:1' })
      });
      await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Item B', input: 'plex:2' })
      });

      // Get current items
      const beforeResponse = await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`);
      const before = await beforeResponse.json();
      expect(before.items[0].label).toBe('Item A');

      // Reorder
      const reordered = [before.items[1], before.items[0]];
      await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: reordered })
      });

      // Verify order changed
      const afterResponse = await fetch(`${getBaseUrl()}${API_BASE}/lists/${TEST_FOLDER.toLowerCase()}`);
      const after = await afterResponse.json();
      expect(after.items[0].label).toBe('Item B');
    });
  });
});
