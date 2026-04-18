import { describe, it, expect } from 'vitest';
import {
  COMMAND_KINDS,
  TRANSPORT_ACTIONS,
  QUEUE_OPS,
  CONFIG_SETTINGS,
  SYSTEM_ACTIONS,
  isCommandKind,
  isTransportAction,
  isQueueOp,
  isConfigSetting,
} from './commands.mjs';

describe('command enums', () => {
  it('lists every command kind', () => {
    expect(COMMAND_KINDS).toEqual(['transport', 'queue', 'config', 'adopt-snapshot', 'system']);
  });
  it('lists every transport action', () => {
    expect(TRANSPORT_ACTIONS).toEqual(
      ['play', 'pause', 'stop', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev']
    );
  });
  it('lists every queue op', () => {
    expect(QUEUE_OPS).toEqual(
      ['play-now', 'play-next', 'add-up-next', 'add', 'reorder', 'remove', 'jump', 'clear']
    );
  });
  it('lists every config setting', () => {
    expect(CONFIG_SETTINGS).toEqual(['shuffle', 'repeat', 'shader', 'volume']);
  });
  it('lists every system action', () => {
    expect(SYSTEM_ACTIONS).toEqual(['reset', 'reload', 'sleep', 'wake']);
  });
  it('provides type guards', () => {
    expect(isCommandKind('transport')).toBe(true);
    expect(isCommandKind('nope')).toBe(false);
    expect(isTransportAction('seekAbs')).toBe(true);
    expect(isTransportAction('rewind')).toBe(false);
    expect(isQueueOp('clear')).toBe(true);
    expect(isConfigSetting('volume')).toBe(true);
  });
});
