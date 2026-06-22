import { describe, it, expect, vi } from 'vitest';
import { createBindingMatcher, parseOn } from './BindingMatcher.js';

describe('parseOn', () => {
  it('parses bare name as truthy', () => {
    expect(parseOn('hp_low')).toEqual({ state: 'hp_low', kind: 'truthy' });
    expect(parseOn('  hp_low  ')).toEqual({ state: 'hp_low', kind: 'truthy' });
  });

  it('parses !name as falsy', () => {
    expect(parseOn('!battle')).toEqual({ state: 'battle', kind: 'falsy' });
    expect(parseOn(' ! battle ')).toEqual({ state: 'battle', kind: 'falsy' });
  });

  it('parses name == value as eq, whitespace-tolerant', () => {
    expect(parseOn('battle == trainer')).toEqual({ state: 'battle', kind: 'eq', value: 'trainer' });
    expect(parseOn('battle==trainer')).toEqual({ state: 'battle', kind: 'eq', value: 'trainer' });
    expect(parseOn('party_count == 6')).toEqual({ state: 'party_count', kind: 'eq', value: '6' });
  });
});

describe('createBindingMatcher', () => {
  it('dispatches all actions for an eq match; ignores non-matching value', () => {
    const handlers = { music: vi.fn(), governance: vi.fn(), chime: vi.fn() };
    const bindings = [
      {
        on: 'battle == trainer',
        do: { music: 'path.mp3', governance: { required_zone: 'hot' } },
      },
    ];
    const m = createBindingMatcher({ bindings, handlers });

    m.onStateChange('battle', { type: 'enum', value: 'trainer' });
    expect(handlers.music).toHaveBeenCalledTimes(1);
    expect(handlers.music).toHaveBeenCalledWith('path.mp3', {
      state: 'battle',
      detail: { type: 'enum', value: 'trainer' },
    });
    expect(handlers.governance).toHaveBeenCalledTimes(1);
    expect(handlers.governance).toHaveBeenCalledWith(
      { required_zone: 'hot' },
      { state: 'battle', detail: { type: 'enum', value: 'trainer' } },
    );

    // non-matching value does not fire
    handlers.music.mockClear();
    m.onStateChange('battle', { type: 'enum', value: 'wild' });
    expect(handlers.music).not.toHaveBeenCalled();
  });

  it('truthy fires on active:true, not active:false; falsy is the inverse', () => {
    const handlers = { chime: vi.fn(), animation: vi.fn(), toast: vi.fn() };
    const bindings = [
      { on: 'hp_low', do: { chime: 'x.mp3' } },
      { on: '!hp_low', do: { toast: 'recovered' } },
    ];
    const m = createBindingMatcher({ bindings, handlers });

    m.onStateChange('hp_low', { type: 'flag', active: true, value: 5 });
    expect(handlers.chime).toHaveBeenCalledTimes(1);
    expect(handlers.toast).not.toHaveBeenCalled();

    m.onStateChange('hp_low', { type: 'flag', active: false, value: 50 });
    expect(handlers.toast).toHaveBeenCalledTimes(1);
    expect(handlers.chime).toHaveBeenCalledTimes(1); // unchanged
  });

  it('routes unknown action to handlers.log', () => {
    const handlers = { log: vi.fn() };
    const bindings = [{ on: 'hp_low', do: { unknown_thing: 'payload' } }];
    const m = createBindingMatcher({ bindings, handlers });
    m.onStateChange('hp_low', { type: 'flag', active: true });
    expect(handlers.log).toHaveBeenCalledWith({ unknownAction: 'unknown_thing', payload: 'payload' });
  });

  it('does not dispatch bindings referencing a different state', () => {
    const handlers = { music: vi.fn() };
    const bindings = [{ on: 'battle == trainer', do: { music: 'x.mp3' } }];
    const m = createBindingMatcher({ bindings, handlers });
    m.onStateChange('hp_low', { type: 'flag', active: true });
    expect(handlers.music).not.toHaveBeenCalled();
  });

  it('never throws when an unknown action has no log handler', () => {
    const handlers = {};
    const bindings = [{ on: 'hp_low', do: { unknown_thing: 'x' } }];
    const m = createBindingMatcher({ bindings, handlers });
    expect(() => m.onStateChange('hp_low', { type: 'flag', active: true })).not.toThrow();
  });

  it('eq matches numbers case-insensitively as strings', () => {
    const handlers = { toast: vi.fn() };
    const bindings = [{ on: 'party_count == 6', do: { toast: 'full party' } }];
    const m = createBindingMatcher({ bindings, handlers });
    m.onStateChange('party_count', { type: 'number', value: 6 });
    expect(handlers.toast).toHaveBeenCalledTimes(1);
  });
});
