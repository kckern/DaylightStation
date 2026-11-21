import { describe, it, expect, vi } from 'vitest';
import { createEffectBindings } from './EffectBindings.js';

const flag = (active) => ({ type: 'flag', active, value: active ? 4 : 7 });

describe('createEffectBindings', () => {
  it('enters on the rising edge and exits on the falling edge', () => {
    const onEffect = vi.fn();
    const eb = createEffectBindings({ bindings: [{ on: 'underground', effect: 'underground_lights' }], onEffect });
    eb.onStateChange('underground', flag(false)); // boot overground: nothing to exit
    eb.onStateChange('underground', flag(true));
    eb.onStateChange('underground', flag(true)); // no repeat
    eb.onStateChange('underground', flag(false));
    expect(onEffect.mock.calls.map(([id, phase]) => [id, phase])).toEqual([
      ['underground_lights', 'enter'],
      ['underground_lights', 'exit'],
    ]);
  });

  it('exitAll exits only what is active', () => {
    const onEffect = vi.fn();
    const eb = createEffectBindings({
      bindings: [{ on: 'underground', effect: 'dark' }, { on: 'battle == trainer', effect: 'battle_lights' }],
      onEffect,
    });
    eb.onStateChange('underground', flag(true));
    expect(eb.getActive()).toEqual(['dark']);
    eb.exitAll('unmount');
    eb.exitAll('unmount');
    expect(onEffect.mock.calls.map(([id, phase, ctx]) => [id, phase, ctx.reason])).toEqual([
      ['dark', 'enter', 'state'],
      ['dark', 'exit', 'unmount'],
    ]);
  });

  it('supports enum equality and ignores do-only bindings', () => {
    const onEffect = vi.fn();
    const eb = createEffectBindings({
      bindings: [{ on: 'battle == trainer', effect: 'battle_lights' }, { on: 'battle == wild', do: { chime: 'x' } }],
      onEffect,
    });
    expect(eb.size).toBe(1);
    eb.onStateChange('battle', { type: 'enum', value: 'wild', raw: 1 });
    eb.onStateChange('battle', { type: 'enum', value: 'trainer', raw: 2 });
    eb.onStateChange('battle', { type: 'enum', value: 'none', raw: 0 });
    expect(onEffect.mock.calls.map(([, phase]) => phase)).toEqual(['enter', 'exit']);
  });

  it('a throwing handler does not break tracking', () => {
    const onEffect = vi.fn(() => { throw new Error('network'); });
    const eb = createEffectBindings({ bindings: [{ on: 'underground', effect: 'dark' }], onEffect });
    eb.onStateChange('underground', flag(true));
    eb.onStateChange('underground', flag(false));
    expect(onEffect).toHaveBeenCalledTimes(2);
  });
});
