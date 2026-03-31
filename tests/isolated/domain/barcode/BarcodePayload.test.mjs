import { describe, it, expect } from '@jest/globals';
import { BarcodePayload } from '#domains/barcode/BarcodePayload.mjs';

const KNOWN_ACTIONS = ['queue', 'play', 'open'];

describe('BarcodePayload', () => {
  describe('two-segment barcode (source:id)', () => {
    it('parses contentId with no action or screen', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBeNull();
      expect(payload.targetScreen).toBeNull();
      expect(payload.device).toBe('scanner-1');
      expect(payload.timestamp).toBe('2026-03-30T01:00:00Z');
    });
  });

  describe('three-segment barcode (action:source:id)', () => {
    it('parses action when first segment is a known action', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('queue');
      expect(payload.targetScreen).toBeNull();
    });

    it('parses screen when first segment is not a known action', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBeNull();
      expect(payload.targetScreen).toBe('living-room');
    });
  });

  describe('four-segment barcode (screen:action:source:id)', () => {
    it('parses both screen and action', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('queue');
      expect(payload.targetScreen).toBe('living-room');
    });

    it('parses play action with screen', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:play:plex:99999', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:99999');
      expect(payload.action).toBe('play');
      expect(payload.targetScreen).toBe('office');
    });
  });

  describe('validation', () => {
    it('returns null for single-segment barcode', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'invalid', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });

    it('returns null for empty barcode', () => {
      const payload = BarcodePayload.parse(
        { barcode: '', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });

    it('returns null for missing barcode field', () => {
      const payload = BarcodePayload.parse(
        { timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });

    it('returns null for missing device field', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:12345', timestamp: '2026-03-30T01:00:00Z' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('serializes all fields', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.toJSON()).toEqual({
        contentId: 'plex:12345',
        action: 'queue',
        targetScreen: 'office',
        device: 'scanner-1',
        timestamp: '2026-03-30T01:00:00Z',
      });
    });
  });
});
