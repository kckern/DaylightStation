import { describe, it, expect } from 'vitest';
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

    it('returns null for too many segments (5+)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'extra:living-room:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload).toBeNull();
    });
  });

  describe('delimiter normalization', () => {
    it('parses semicolon-delimited barcodes', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office;plex;12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.targetScreen).toBe('office');
    });

    it('parses space-delimited barcodes', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'play plex 12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('play');
    });

    it('parses mixed delimiters', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office;play:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('play');
      expect(payload.targetScreen).toBe('office');
    });

    it('preserves dashes in screen names (not a delimiter)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room;plex;12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.targetScreen).toBe('living-room');
    });
  });

  describe('command barcodes', () => {
    const KNOWN_COMMANDS = ['pause', 'play', 'next', 'prev', 'ffw', 'rew', 'stop', 'off', 'blackout', 'volume', 'speed'];

    it('parses a bare command (1 segment)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'pause', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('pause');
      expect(payload.commandArg).toBeNull();
      expect(payload.targetScreen).toBeNull();
      expect(payload.contentId).toBeNull();
    });

    it('parses screen:command (2 segments, second is command)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:pause', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('pause');
      expect(payload.targetScreen).toBe('office');
      expect(payload.commandArg).toBeNull();
    });

    it('parses command:arg (2 segments, first is command)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'volume:30', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('volume');
      expect(payload.commandArg).toBe('30');
      expect(payload.targetScreen).toBeNull();
    });

    it('parses screen:command:arg (3 segments)', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:volume:30', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('volume');
      expect(payload.commandArg).toBe('30');
      expect(payload.targetScreen).toBe('office');
    });

    it('parses semicolon-delimited commands', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office;pause', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('pause');
      expect(payload.targetScreen).toBe('office');
    });

    it('falls through to content for 4+ segments even if play is a command', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:play:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('content');
      expect(payload.contentId).toBe('plex:12345');
      expect(payload.action).toBe('play');
      expect(payload.targetScreen).toBe('office');
    });

    it('preserves dashes in screen names for commands', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'living-room;blackout', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS, KNOWN_COMMANDS
      );
      expect(payload.type).toBe('command');
      expect(payload.command).toBe('blackout');
      expect(payload.targetScreen).toBe('living-room');
    });
  });

  describe('content options', () => {
    it('parses boolean option with +', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:595104+shuffle', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:595104');
      expect(payload.options).toEqual({ shuffle: true });
    });

    it('parses key=value option', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:595104+shader=dark', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:595104');
      expect(payload.options).toEqual({ shader: 'dark' });
    });

    it('parses multiple options', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:595104+shuffle+shader=dark+volume=10', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:595104');
      expect(payload.options).toEqual({ shuffle: true, shader: 'dark', volume: '10' });
    });

    it('works with screen and action prefixes', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office;queue;plex;595104+shuffle+continuous', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.contentId).toBe('plex:595104');
      expect(payload.targetScreen).toBe('office');
      expect(payload.action).toBe('queue');
      expect(payload.options).toEqual({ shuffle: true, continuous: true });
    });

    it('returns null options when no + present', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.options).toBeNull();
    });
  });

  describe('toJSON', () => {
    it('serializes all fields', () => {
      const payload = BarcodePayload.parse(
        { barcode: 'office:queue:plex:12345', timestamp: '2026-03-30T01:00:00Z', device: 'scanner-1' },
        KNOWN_ACTIONS
      );
      expect(payload.toJSON()).toEqual({
        type: 'content',
        contentId: 'plex:12345',
        action: 'queue',
        command: null,
        commandArg: null,
        options: null,
        targetScreen: 'office',
        device: 'scanner-1',
        timestamp: '2026-03-30T01:00:00Z',
      });
    });
  });
});
