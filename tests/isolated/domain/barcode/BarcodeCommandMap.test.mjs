import { describe, it, expect } from 'vitest';
import { COMMAND_MAP, KNOWN_COMMANDS, resolveCommand } from '#domains/barcode/BarcodeCommandMap.mjs';

describe('BarcodeCommandMap', () => {
  describe('KNOWN_COMMANDS', () => {
    it('contains all command names', () => {
      expect(KNOWN_COMMANDS).toContain('pause');
      expect(KNOWN_COMMANDS).toContain('play');
      expect(KNOWN_COMMANDS).toContain('next');
      expect(KNOWN_COMMANDS).toContain('prev');
      expect(KNOWN_COMMANDS).toContain('ffw');
      expect(KNOWN_COMMANDS).toContain('rew');
      expect(KNOWN_COMMANDS).toContain('stop');
      expect(KNOWN_COMMANDS).toContain('off');
      expect(KNOWN_COMMANDS).toContain('blackout');
      expect(KNOWN_COMMANDS).toContain('volume');
      expect(KNOWN_COMMANDS).toContain('speed');
    });

    it('is derived from COMMAND_MAP keys', () => {
      expect(KNOWN_COMMANDS).toEqual(Object.keys(COMMAND_MAP));
    });
  });

  describe('resolveCommand', () => {
    it('resolves simple playback commands', () => {
      expect(resolveCommand('pause')).toEqual({ playback: 'pause' });
      expect(resolveCommand('play')).toEqual({ playback: 'play' });
      expect(resolveCommand('next')).toEqual({ playback: 'next' });
      expect(resolveCommand('prev')).toEqual({ playback: 'prev' });
      expect(resolveCommand('ffw')).toEqual({ playback: 'fwd' });
      expect(resolveCommand('rew')).toEqual({ playback: 'rew' });
    });

    it('resolves action commands', () => {
      expect(resolveCommand('stop')).toEqual({ action: 'reset' });
      expect(resolveCommand('off')).toEqual({ action: 'sleep' });
    });

    it('resolves display commands', () => {
      expect(resolveCommand('blackout')).toEqual({ shader: 'blackout' });
    });

    it('resolves parameterized commands', () => {
      expect(resolveCommand('volume', '30')).toEqual({ volume: 30 });
      expect(resolveCommand('speed', '1.5')).toEqual({ rate: 1.5 });
    });

    it('returns null for unknown commands', () => {
      expect(resolveCommand('unknown')).toBeNull();
    });
  });
});
