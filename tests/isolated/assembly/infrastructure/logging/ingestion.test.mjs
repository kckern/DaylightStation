// tests/unit/infrastructure/logging/ingestion.test.mjs
import { jest, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import { initializeLogging, resetLogging } from '#backend/src/0_system/logging/dispatcher.mjs';
import { ingestFrontendLogs } from '#backend/src/0_system/logging/ingestion.mjs';

describe('ingestFrontendLogs', () => {
  let dispatchedEvents;
  let mockTransport;

  beforeEach(() => {
    resetLogging();
    dispatchedEvents = [];
    mockTransport = {
      name: 'mock',
      send: (event) => dispatchedEvents.push(event)
    };
    const dispatcher = initializeLogging({ defaultLevel: 'debug' });
    dispatcher.addTransport(mockTransport);
  });

  afterEach(() => {
    resetLogging();
  });

  describe('when logging not initialized', () => {
    test('returns 0 when logging not initialized', () => {
      resetLogging();
      const result = ingestFrontendLogs({ event: 'test.event', level: 'info' });
      expect(result).toBe(0);
    });
  });

  describe('payload normalization', () => {
    test('handles null payload', () => {
      const result = ingestFrontendLogs(null);
      expect(result).toBe(0);
    });

    test('handles undefined payload', () => {
      const result = ingestFrontendLogs(undefined);
      expect(result).toBe(0);
    });

    test('handles array of events in payload.events', () => {
      const result = ingestFrontendLogs({
        events: [
          { event: 'event1', level: 'info' },
          { event: 'event2', level: 'debug' }
        ]
      });

      expect(result).toBe(2);
      expect(dispatchedEvents.length).toBe(2);
    });

    test('handles single event with event string', () => {
      const result = ingestFrontendLogs({
        event: 'single.event',
        level: 'info',
        data: { key: 'value' }
      });

      expect(result).toBe(1);
      expect(dispatchedEvents.length).toBe(1);
    });

    test('handles playback-logger source format', () => {
      const result = ingestFrontendLogs({
        source: 'playback-logger',
        event: 'playback.started',
        level: 'info',
        payload: { mediaId: '123' },
        timestamp: '2026-01-11T10:00:00Z'
      });

      expect(result).toBe(1);
      expect(dispatchedEvents[0].event).toBe('playback.started');
      expect(dispatchedEvents[0].data.mediaId).toBe('123');
      expect(dispatchedEvents[0].context.channel).toBe('playback');
    });
  });

  describe('event normalization', () => {
    test('normalizes level to lowercase', () => {
      ingestFrontendLogs({ event: 'test', level: 'INFO' });

      expect(dispatchedEvents[0].level).toBe('info');
    });

    test('defaults level to info for invalid values', () => {
      ingestFrontendLogs({ event: 'test', level: 'invalid' });

      expect(dispatchedEvents[0].level).toBe('info');
    });

    test('defaults level to info when missing', () => {
      ingestFrontendLogs({ event: 'test' });

      expect(dispatchedEvents[0].level).toBe('info');
    });

    test('uses frontend.unknown for missing event name', () => {
      ingestFrontendLogs({ level: 'info', data: {} });

      expect(dispatchedEvents[0].event).toBe('frontend.unknown');
    });

    test('preserves original timestamp', () => {
      const ts = '2026-01-11T10:00:00Z';
      ingestFrontendLogs({ event: 'test', ts });

      expect(dispatchedEvents[0].ts).toBe(ts);
    });

    test('includes client metadata in context', () => {
      ingestFrontendLogs(
        { event: 'test', level: 'info' },
        { ip: '192.168.1.1', userAgent: 'Mozilla/5.0' }
      );

      expect(dispatchedEvents[0].context.source).toBe('frontend');
      expect(dispatchedEvents[0].context.ip).toBe('192.168.1.1');
      expect(dispatchedEvents[0].context.userAgent).toBe('Mozilla/5.0');
    });

    test('merges data from payload or data field', () => {
      ingestFrontendLogs({
        event: 'test',
        level: 'info',
        data: { key: 'value' }
      });

      expect(dispatchedEvents[0].data.key).toBe('value');
    });

    test('uses payload field as fallback for data', () => {
      ingestFrontendLogs({
        event: 'test',
        level: 'info',
        payload: { key: 'value' }
      });

      expect(dispatchedEvents[0].data.key).toBe('value');
    });

    test('preserves tags array', () => {
      ingestFrontendLogs({
        event: 'test',
        level: 'info',
        tags: ['frontend', 'user-action']
      });

      expect(dispatchedEvents[0].tags).toEqual(['frontend', 'user-action']);
    });
  });

  describe('nested event unwrapping', () => {
    test('unwraps nested event object', () => {
      ingestFrontendLogs({
        events: [{
          event: {
            event: 'nested.event',
            level: 'debug',
            data: { nested: true }
          }
        }]
      });

      expect(dispatchedEvents[0].event).toBe('nested.event');
    });
  });
});
