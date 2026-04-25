/**
 * TriggerConfig — multi-modality parser tests.
 *
 * Verifies that parseTriggerConfig produces a location-rooted registry where
 * each location's `entries` is an object keyed by modality (`nfc`, `state`,
 * `barcode`, `voice`). Modalities absent from YAML are absent from `entries`.
 */
import { describe, it, expect } from 'vitest';

import { parseTriggerConfig } from '#domains/trigger/TriggerConfig.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

describe('parseTriggerConfig (multi-modality)', () => {
  it('returns empty registry for null/undefined input', () => {
    expect(parseTriggerConfig(null)).toEqual({});
    expect(parseTriggerConfig(undefined)).toEqual({});
  });

  it('parses an nfc-only location into entries.nfc', () => {
    const raw = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play',
        tags: { '83_8e_68_06': { plex: 620707 } },
      },
    };
    const out = parseTriggerConfig(raw);
    expect(out.livingroom.target).toBe('livingroom-tv');
    expect(out.livingroom.action).toBe('play');
    expect(out.livingroom.entries.nfc['83_8e_68_06']).toEqual({ plex: 620707 });
    expect(out.livingroom.entries.state).toBeUndefined();
  });

  it('parses a location with both nfc and state modalities', () => {
    const raw = {
      livingroom: {
        target: 'livingroom-tv',
        action: 'play',
        tags: { '83_8e_68_06': { plex: 620707 } },
        states: { off: { action: 'clear' } },
      },
    };
    const out = parseTriggerConfig(raw);
    expect(out.livingroom.entries.nfc['83_8e_68_06']).toEqual({ plex: 620707 });
    expect(out.livingroom.entries.state.off).toEqual({ action: 'clear' });
  });

  it('lowercases entry keys per modality', () => {
    const raw = {
      livingroom: {
        target: 't',
        tags: { 'AB_CD': {} },
        states: { OFF: { action: 'clear' } },
      },
    };
    const out = parseTriggerConfig(raw);
    expect(out.livingroom.entries.nfc.ab_cd).toBeDefined();
    expect(out.livingroom.entries.state.off).toBeDefined();
  });

  it('throws when a location is missing a target', () => {
    expect(() => parseTriggerConfig({ livingroom: { action: 'play' } }))
      .toThrow(ValidationError);
  });

  it('throws when a location is not an object', () => {
    expect(() => parseTriggerConfig({ livingroom: 'not an object' }))
      .toThrow(ValidationError);
  });

  it('throws when a modality block is not an object', () => {
    expect(() => parseTriggerConfig({
      livingroom: { target: 't', tags: 'broken' },
    })).toThrow(ValidationError);
  });

  it('throws when an entry value is not an object', () => {
    expect(() => parseTriggerConfig({
      livingroom: { target: 't', tags: { 'ab': 'broken' } },
    })).toThrow(ValidationError);
  });

  it('exposes auth_token at the location level', () => {
    const raw = {
      livingroom: { target: 't', auth_token: 'sekret', tags: {} },
    };
    expect(parseTriggerConfig(raw).livingroom.auth_token).toBe('sekret');
  });

  it('defaults auth_token to null when absent', () => {
    expect(parseTriggerConfig({ livingroom: { target: 't' } }).livingroom.auth_token).toBeNull();
  });
});
