// The Play-on row for the phone tells the truth: a closed app cannot be played to.
// ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §3.2.
import { describe, it, expect } from 'vitest';
import { pickerRowState } from './castCopy.js';

const phone = { id: 'phone', type: 'phone', content_control: { provider: 'phone-inbox' } };

describe('Play on: the phone row', () => {
  it('a phone not listening (never heard, offline, stale) says how to make it listen and is disabled', () => {
    for (const entry of [null, { offline: true }, { isStale: true, snapshot: { state: 'idle' } }]) {
      expect(pickerRowState({ entry, device: phone })).toMatchObject({ text: 'Open the app on the phone to play here', disabled: true, tone: 'off' });
    }
  });

  it('a listening phone is offered as usual', () => {
    const s = pickerRowState({ entry: { snapshot: { state: 'idle' } }, device: phone });
    expect(s.disabled).toBe(false);
    expect(s.text).toBe('Ready');
  });

  it('a screen that is offline is unchanged (Asleep, still offered: it can be woken)', () => {
    const s = pickerRowState({ entry: { offline: true }, device: { id: 'office-tv', type: 'linux-pc' } });
    expect(s).toMatchObject({ text: 'Asleep', disabled: false });
  });
});
