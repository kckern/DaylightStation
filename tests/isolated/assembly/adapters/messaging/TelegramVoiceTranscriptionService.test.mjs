// tests/isolated/assembly/adapters/messaging/TelegramVoiceTranscriptionService.test.mjs

import { TelegramVoiceTranscriptionService } from '#backend/src/1_adapters/messaging/TelegramVoiceTranscriptionService.mjs';

describe('TelegramVoiceTranscriptionService', () => {
  let service;
  let mockOpenai;
  let mockHttpClient;
  let mockLogger;

  beforeEach(() => {
    mockOpenai = {
      transcribe: jest.fn().mockResolvedValue('hello world'),
      isConfigured: jest.fn().mockReturnValue(true),
    };
    mockHttpClient = {
      downloadBuffer: jest.fn().mockResolvedValue(Buffer.from('audio-data')),
    };
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    service = new TelegramVoiceTranscriptionService(
      { openaiAdapter: mockOpenai },
      { httpClient: mockHttpClient, logger: mockLogger },
    );
  });

  describe('transcribeUrl() download retries', () => {
    it('should succeed on first attempt without retry', async () => {
      const result = await service.transcribeUrl('https://telegram.org/file/voice.oga');
      expect(result.text).toBe('hello world');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(1);
    });

    it('should retry on transient download error and recover', async () => {
      const transientError = new Error('fetch failed');
      transientError.isTransient = true;
      transientError.code = 'TIMEOUT';
      mockHttpClient.downloadBuffer
        .mockRejectedValueOnce(transientError)
        .mockResolvedValue(Buffer.from('audio-data'));

      const result = await service.transcribeUrl('https://telegram.org/file/voice.oga');
      expect(result.text).toBe('hello world');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(2);
      // Should log the retry
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'telegram-voice.download.retry',
        expect.objectContaining({ attempt: 1 }),
      );
    });

    it('should NOT retry on non-transient download error', async () => {
      const permanentError = new Error('HTTP 403: Forbidden');
      permanentError.isTransient = false;
      permanentError.code = 'FORBIDDEN';
      mockHttpClient.downloadBuffer.mockRejectedValue(permanentError);

      await expect(service.transcribeUrl('https://telegram.org/file/voice.oga'))
        .rejects.toThrow('Failed to download audio');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(1);
    });

    it('should throw after exhausting retries', async () => {
      const transientError = new Error('fetch failed');
      transientError.isTransient = true;
      transientError.code = 'TIMEOUT';
      mockHttpClient.downloadBuffer.mockRejectedValue(transientError);

      await expect(service.transcribeUrl('https://telegram.org/file/voice.oga'))
        .rejects.toThrow('Failed to download audio');
      expect(mockHttpClient.downloadBuffer).toHaveBeenCalledTimes(3);
    });
  });
});
