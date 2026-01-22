// tests/unit/fitness/fitness-simulate-api.unit.test.mjs
import { describe, test, expect } from '@jest/globals';

describe('Fitness Simulation API', () => {
  const BACKEND_URL = 'http://localhost:3112';

  const serverAvailable = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/fitness`);
      return true;
    } catch {
      return false;
    }
  };

  test.skip('POST /api/fitness/simulate starts simulation', async () => {
    if (!await serverAvailable()) return;

    const response = await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 10, users: 1, rpm: 0 })
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.started).toBe(true);
    expect(data.pid).toBeDefined();

    await fetch(`${BACKEND_URL}/api/fitness/simulate`, { method: 'DELETE' });
  });

  test.skip('DELETE /api/fitness/simulate stops simulation', async () => {
    if (!await serverAvailable()) return;

    await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ duration: 60 })
    });

    const response = await fetch(`${BACKEND_URL}/api/fitness/simulate`, {
      method: 'DELETE'
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.stopped).toBe(true);
  });

  test.skip('GET /api/fitness/simulate/status returns current state', async () => {
    if (!await serverAvailable()) return;

    const response = await fetch(`${BACKEND_URL}/api/fitness/simulate/status`);
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data).toHaveProperty('running');
  });
});
