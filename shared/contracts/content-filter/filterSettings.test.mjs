import { describe, it, expect } from 'vitest';
import { LANGUAGE_VALUES, mergeSettings, normalizeLanguage, settingsFromProfile, profilePatchFromSettings, mergeProfilePatch, applySettingsToProfile, LEVELS } from './filterSettings.mjs';

const FAMILY = {
  name: 'Family',
  categories: {
    language: { effect: 'mute' },
    violence_blood_gore: { effect: false },
    'violence_blood_gore/graphic': { effect: 'full-blur' },
    'violence_blood_gore/gore': { effect: 'full-blur' },
    sex_nudity_immodesty: { effect: 'full-blur' },
    nudity: { effect: 'full-blur' },
    sex_any: { effect: 'full-blur' },
    'sex_any/sexual_assault': { effect: 'full-blur' },
  },
  treatments: { mute: { default: { replace: 'silence' } }, 'skip-card': { holdSec: 4.5 } },
  theme: { font: 'Roboto Condensed' },
  scenes: {
    violence_blood_gore: { blackout: { picture: 2 } },
    sex_nudity_immodesty: { blackout: { picture: 2 } },
    sex_any: { blackout: { picture: 2 }, skip: { situation: 3 } },
  },
};

const ALL = (v) => ({ profanity: v, blasphemy: v, sexual: v, slurs: v, childish: v });

describe('filterSettings', () => {
  it('reads the live family profile', () => {
    expect(settingsFromProfile(FAMILY)).toEqual({ language: ALL('mute'), violence: 'blackout', nudity: 'blackout', sexual: 'skip' });
  });

  it('round-trips every row', () => {
    const languages = [ALL('mute'), ALL('bleep'), ALL('off'),
      { profanity: 'bleep', blasphemy: 'mute', sexual: 'off', slurs: 'bleep', childish: 'mute' },
      { profanity: 'off', blasphemy: 'off', sexual: 'mute', slurs: 'off', childish: 'bleep' }];
    for (const language of languages) {
      for (const violence of LEVELS) for (const nudity of LEVELS) for (const sexual of LEVELS) {
        const s = { language, violence, nudity, sexual };
        expect(settingsFromProfile(applySettingsToProfile(FAMILY, s))).toEqual(s);
        expect(settingsFromProfile(mergeProfilePatch(FAMILY, profilePatchFromSettings(s)))).toEqual(s);
      }
    }
  });

  it('maps the table exactly', () => {
    const p = profilePatchFromSettings({ language: ALL('bleep'), violence: 'skip', nudity: 'off', sexual: 'skip' });
    for (const g of ['profanity', 'blasphemy', 'sexual', 'slurs', 'childish']) expect(p.categories[`language/${g}`]).toEqual({ effect: 'bleep' });
    expect(p.categories.violence_blood_gore).toEqual({ effect: 'off' });
    expect(p.categories['violence_blood_gore/gore']).toEqual({ effect: 'full-blur' });
    expect(p.categories.nudity).toEqual({ effect: 'off' });
    expect(p.scenes.violence_blood_gore).toEqual({ skip: { picture: 2 } });
    expect(p.scenes.sex_any).toEqual({ blackout: { picture: 2 }, skip: { situation: 3 } });
  });

  it('Everywhere keeps treatments, theme, name; drops empty owned scene groups', () => {
    const out = applySettingsToProfile(FAMILY, { language: ALL('off'), violence: 'off', nudity: 'blur', sexual: 'blackout' });
    expect(out.name).toBe('Family');
    expect(out.treatments).toEqual(FAMILY.treatments);
    expect(out.theme).toEqual(FAMILY.theme);
    expect(out.scenes).toEqual({ sex_any: { blackout: { picture: 2 } } });
  });

  it('merge: patch wins per key and theme is kept', () => {
    const m = mergeProfilePatch(FAMILY, { categories: { language: { effect: 'off' } }, scenes: { sex_any: {} } });
    expect(m.categories.language).toEqual({ effect: 'off' });
    expect(m.categories.nudity).toEqual({ effect: 'full-blur' });
    expect(m.theme).toEqual(FAMILY.theme);
    expect(m.scenes.sex_any).toEqual({});
    expect(mergeProfilePatch(null, {})).toBeNull();
  });

  it('reads the old single language rule as all five groups; a group rule beats it', () => {
    expect(settingsFromProfile({ categories: { language: { effect: 'bleep' } } }).language).toEqual(ALL('bleep'));
    const mixed = { categories: { language: { effect: 'mute' }, 'language/childish': { effect: 'off' }, 'language/slurs': { effect: 'bleep' } } };
    expect(settingsFromProfile(mixed).language).toEqual({ profanity: 'mute', blasphemy: 'mute', sexual: 'mute', slurs: 'bleep', childish: 'off' });
    expect(settingsFromProfile({}).language).toEqual(ALL('off'));
  });

  it('missing groups take the defaults; a legacy string sets all five', () => {
    expect(normalizeLanguage(undefined)).toEqual({ profanity: 'mute', blasphemy: 'mute', sexual: 'mute', slurs: 'mute', childish: 'off' });
    expect(normalizeLanguage('bleep')).toEqual(ALL('bleep'));
    expect(normalizeLanguage({ slurs: 'bleep', childish: 'nonsense' })).toMatchObject({ slurs: 'bleep', childish: 'off', profanity: 'mute' });
    expect(LANGUAGE_VALUES).toEqual(['mute', 'bleep', 'off']);
  });

  it('mergeSettings changes one group and leaves the rest', () => {
    const cur = { language: ALL('mute'), violence: 'off' };
    expect(mergeSettings(cur, { language: { slurs: 'bleep' } }).language).toEqual({ ...ALL('mute'), slurs: 'bleep' });
    expect(mergeSettings(cur, { language: 'off' }).language).toEqual(ALL('off'));
    expect(mergeSettings(cur, { violence: 'skip' }).language).toEqual(ALL('mute'));
  });

  it('merge carries per-word exceptions from a film patch', () => {
    const m = mergeProfilePatch({ languageWords: { damn: 'off', hell: 'mute' } }, { languageWords: { hell: 'bleep' } });
    expect(m.languageWords).toEqual({ damn: 'off', hell: 'bleep' });
  });
});
