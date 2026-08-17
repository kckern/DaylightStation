// actionCapability.test.js — the rule that catches an action pointed at a
// source that cannot perform it.
//
// Origin: an FHE list row read `input: files:art/fhe/esther.jpg` with
// `action: Display`. The `files` source reports only `playable` for an image;
// `canvas` reports `displayable`. Nothing compared the two, so the TV rendered
// an empty <img> and the admin preview reproduced the same blank box.
//
// The rule's job is to be QUIET. A warning that fires on healthy rows gets
// ignored, and then it protects nothing.
import { describe, it, expect } from 'vitest';
import { capabilityMismatch, ACTION_CAPABILITIES } from './actionCapability.js';

describe('capabilityMismatch', () => {
  it('flags Display on a source that is only playable', () => {
    const result = capabilityMismatch('Display', ['playable']);
    expect(result).toEqual({ action: 'Display', accepts: ['displayable'] });
  });

  it('stays quiet when the source can do what the action asks', () => {
    expect(capabilityMismatch('Display', ['displayable'])).toBeNull();
    expect(capabilityMismatch('Play', ['playable', 'displayable'])).toBeNull();
    expect(capabilityMismatch('Open', ['openable'])).toBeNull();
    expect(capabilityMismatch('List', ['displayable', 'listable', 'queueable'])).toBeNull();
  });

  it('accepts a plain playable for Queue', () => {
    // A leaf that can be played can obviously be queued; only containers ever
    // report `queueable`. Demanding it would flag every single-track Queue row.
    expect(capabilityMismatch('Queue', ['playable'])).toBeNull();
    expect(capabilityMismatch('Queue', ['queueable'])).toBeNull();
  });

  it('never judges Read', () => {
    // No adapter emits `readable` — readalong reports playable/displayable.
    // Asserting a capability nothing produces is a guaranteed false alarm.
    expect(capabilityMismatch('Read', ['playable', 'displayable'])).toBeNull();
    expect(capabilityMismatch('Read', [])).toBeNull();
    expect(ACTION_CAPABILITIES.Read).toBeUndefined();
  });

  it('treats missing or empty capabilities as "cannot judge"', () => {
    // A failed lookup must not read as a broken row.
    expect(capabilityMismatch('Display', [])).toBeNull();
    expect(capabilityMismatch('Display', null)).toBeNull();
    expect(capabilityMismatch('Display', undefined)).toBeNull();
  });

  it('does not judge an action it has no rule for', () => {
    expect(capabilityMismatch('Frobnicate', ['playable'])).toBeNull();
    expect(capabilityMismatch(undefined, ['playable'])).toBeNull();
  });

  it('defaults a blank action to Play, matching the list renderer', () => {
    // ListAdapter: `const actionType = (item.action || 'Play')`.
    expect(capabilityMismatch('', ['displayable'])).toEqual({
      action: 'Play',
      accepts: ['playable'],
    });
    expect(capabilityMismatch('', ['playable'])).toBeNull();
  });
});
