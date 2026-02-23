import { describe, it, expect } from '@jest/globals';
import { LaunchableItem } from '#domains/content/entities/LaunchableItem.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('LaunchableItem', () => {
  const validProps = {
    id: 'retroarch:n64/mario-kart-64',
    source: 'retroarch',
    localId: 'n64/mario-kart-64',
    title: 'Mario Kart 64',
    type: 'game',
    launchIntent: {
      target: 'com.example/ActivityFuture',
      params: { ROM: '/path/to/rom.n64', LIBRETRO: '/path/to/core.so' }
    },
    deviceConstraint: 'android',
    console: 'n64'
  };

  describe('constructor', () => {
    it('creates a LaunchableItem with all fields', () => {
      const item = new LaunchableItem(validProps);
      expect(item.id).toBe('retroarch:n64/mario-kart-64');
      expect(item.source).toBe('retroarch');
      expect(item.title).toBe('Mario Kart 64');
      expect(item.type).toBe('game');
      expect(item.launchIntent).toEqual(validProps.launchIntent);
      expect(item.deviceConstraint).toBe('android');
      expect(item.console).toBe('n64');
    });

    it('inherits Item behavior (requires title)', () => {
      expect(() => new LaunchableItem({ ...validProps, title: undefined }))
        .toThrow(ValidationError);
    });

    it('defaults launchIntent, deviceConstraint and console to null', () => {
      const item = new LaunchableItem({
        ...validProps,
        launchIntent: undefined,
        deviceConstraint: undefined,
        console: undefined
      });
      expect(item.launchIntent).toBeNull();
      expect(item.deviceConstraint).toBeNull();
      expect(item.console).toBeNull();
    });

    it('isPlayable returns false', () => {
      const item = new LaunchableItem(validProps);
      expect(item.isPlayable()).toBe(false);
    });

    it('isLaunchable returns true', () => {
      const item = new LaunchableItem(validProps);
      expect(item.isLaunchable()).toBe(true);
    });
  });
});
