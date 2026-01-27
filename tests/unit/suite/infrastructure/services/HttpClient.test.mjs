// tests/unit/suite/infrastructure/services/HttpClient.test.mjs

import { HttpClient } from '#backend/src/0_system/services/HttpClient.mjs';
import { HttpError } from '#backend/src/0_system/services/HttpError.mjs';

describe('HttpClient', () => {
  let client;
  let mockLogger;

  beforeEach(() => {
    mockLogger = { debug: jest.fn(), error: jest.fn() };
    client = new HttpClient({ logger: mockLogger });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('get()', () => {
    it('should make GET request and return parsed JSON', async () => {
      const mockResponse = { id: 1, name: 'test' };
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.get('https://api.example.com/data');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.data).toEqual(mockResponse);
      expect(result.ok).toBe(true);
    });

    it('should throw HttpError on 404', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'not found' })
      });

      await expect(client.get('https://api.example.com/missing'))
        .rejects.toThrow(HttpError);
    });
  });

  describe('post()', () => {
    it('should make POST request with JSON body', async () => {
      const requestBody = { name: 'test' };
      const mockResponse = { id: 1, name: 'test' };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve(mockResponse)
      });

      const result = await client.post('https://api.example.com/data', requestBody);

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/data',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody)
        })
      );
      expect(result.data).toEqual(mockResponse);
    });
  });

  describe('error handling', () => {
    it('should mark 429 as transient', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({}),
        text: () => Promise.resolve('rate limited')
      });

      try {
        await client.get('https://api.example.com/data');
      } catch (error) {
        expect(error.isTransient).toBe(true);
        expect(error.code).toBe('RATE_LIMITED');
      }
    });

    it('should mark 500 as transient', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({}),
        text: () => Promise.resolve('server error')
      });

      try {
        await client.get('https://api.example.com/data');
      } catch (error) {
        expect(error.isTransient).toBe(true);
      }
    });

    it('should mark 400 as not transient', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({}),
        text: () => Promise.resolve('bad request')
      });

      try {
        await client.get('https://api.example.com/data');
      } catch (error) {
        expect(error.isTransient).toBe(false);
        expect(error.code).toBe('BAD_REQUEST');
      }
    });
  });

  describe('downloadBuffer()', () => {
    it('should return Buffer from response', async () => {
      const mockData = new Uint8Array([1, 2, 3, 4]).buffer;

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({}),
        arrayBuffer: () => Promise.resolve(mockData)
      });

      const result = await client.downloadBuffer('https://example.com/file.bin');

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(4);
    });
  });
});
