// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { TTSAssetResolver } from '../../../backend/src/1_adapters/livestream/TTSAssetResolver.mjs';

describe('TTSAssetResolver', () => {
  let resolver;
  let mockTTSAdapter;
  let cacheDir;
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    cacheDir = path.join(os.tmpdir(), `livestream-tts-test-${Date.now()}`);
    fs.mkdirSync(cacheDir, { recursive: true });

    mockTTSAdapter = {
      isConfigured: vi.fn(() => true),
      generateSpeechBuffer: vi.fn(async () => Buffer.from('fake-mp3-data')),
    };

    resolver = new TTSAssetResolver({
      ttsAdapter: mockTTSAdapter,
      cacheDir,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  describe('resolve file spec', () => {
    it('resolves semantic file ids to opaque resources', async () => {
      fs.mkdirSync(path.join(cacheDir, 'audio'), { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'audio', 'track.mp3'), 'track');
      const result = await resolver.resolve({ type: 'file', assetId: 'audio/track.mp3' });
      expect(result.assetId).toBe('audio/track.mp3');
      expect(result.resource).not.toHaveProperty('path');
      expect(result.resource.size).toBe(5);
    });
  });

  describe('resolve TTS spec', () => {
    it('generates audio and returns an opaque cached resource', async () => {
      const result = await resolver.resolve({ type: 'tts', text: 'Hello world', voice: 'nova' });
      expect(result.assetId).toMatch(/^tts:/);
      expect(result.resource).not.toHaveProperty('path');
      expect(result.resource.size).toBeGreaterThan(0);
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledWith(
        'Hello world',
        expect.objectContaining({ voice: 'nova' })
      );
    });

    it('returns cached file on second call with same text', async () => {
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledTimes(1);
    });

    it('generates new file for different text', async () => {
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      await resolver.resolve({ type: 'tts', text: 'Goodbye', voice: 'nova' });
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledTimes(2);
    });

    it('generates new file for different voice', async () => {
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'nova' });
      await resolver.resolve({ type: 'tts', text: 'Hello', voice: 'alloy' });
      expect(mockTTSAdapter.generateSpeechBuffer).toHaveBeenCalledTimes(2);
    });
  });

  describe('resolveAll', () => {
    it('resolves multiple specs in parallel', async () => {
      const results = await resolver.resolveAll([
        { type: 'tts', text: 'A', voice: 'nova' },
        { type: 'tts', text: 'Test', voice: 'nova' },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].assetId).toMatch(/^tts:/);
      expect(results[1].assetId).toMatch(/^tts:/);
    });
  });

  describe('cleanup', () => {
    it('removes files older than TTL', async () => {
      await resolver.resolve({ type: 'tts', text: 'Old text', voice: 'nova' });
      const files = fs.readdirSync(cacheDir);
      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
      for (const f of files) {
        fs.utimesSync(path.join(cacheDir, f), oldTime, oldTime);
      }
      resolver.cleanup(24 * 60 * 60 * 1000);
      const remaining = fs.readdirSync(cacheDir);
      expect(remaining).toHaveLength(0);
    });
  });
});
