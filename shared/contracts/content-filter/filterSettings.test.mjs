import { describe, it, expect } from 'vitest';
import { settingsFromProfile, profilePatchFromSettings, mergeProfilePatch, applySettingsToProfile, LEVELS } from './filterSettings.mjs';

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

describe('filterSettings', () => {
  it('reads the live family profile', () => {
    expect(settingsFromProfile(FAMILY)).toEqual({ language: 'mute', violence: 'blackout', nudity: 'blackout', sexual: 'skip' });
  });

  it('round-trips every row', () => {
    for (const language of ['mute', 'bleep', 'off']) {
      for (const violence of LEVELS) for (const nudity of LEVELS) for (const sexual of LEVELS) {
        const s = { language, violence, nudity, sexual };
        expect(settingsFromProfile(applySettingsToProfile(FAMILY, s))).toEqual(s);
        expect(settingsFromProfile(mergeProfilePatch(FAMILY, profilePatchFromSettings(s)))).toEqual(s);
      }
    }
  });

  it('maps the table exactly', () => {
    const p = profilePatchFromSettings({ language: 'bleep', violence: 'skip', nudity: 'off', sexual: 'skip' });
    expect(p.categories.language).toEqual({ effect: 'bleep' });
    expect(p.categories.violence_blood_gore).toEqual({ effect: 'off' });
    expect(p.categories['violence_blood_gore/gore']).toEqual({ effect: 'full-blur' });
    expect(p.categories.nudity).toEqual({ effect: 'off' });
    expect(p.scenes.violence_blood_gore).toEqual({ skip: { picture: 2 } });
    expect(p.scenes.sex_any).toEqual({ blackout: { picture: 2 }, skip: { situation: 3 } });
  });

  it('Everywhere keeps treatments, theme, name; drops empty owned scene groups', () => {
    const out = applySettingsToProfile(FAMILY, { language: 'off', violence: 'off', nudity: 'blur', sexual: 'blackout' });
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
});
