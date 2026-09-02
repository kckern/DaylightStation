import { describe, it, expect } from 'vitest';
import { PACKS } from '../lib/theme/packs.mjs';
import { createAppTheme } from '../lib/theme/createAppTheme.js';

// LifeApp no longer owns a bespoke theme file — it consumes the shared
// `life` pack via AppThemeProvider (see LifeApp.jsx). This pins the pack's
// own identity (violet, per the DS migration) plus the Mantine theme it
// produces, which is what the old LifeApp.theme.js test actually cared
// about. The pack-machinery mechanics themselves (every pack has a name/
// character/primaryColor/accent, createAppTheme yields 10-shade ramps) are
// covered generically by lib/theme/tokens.test.mjs.
describe('life theme pack', () => {
  it('is violet, per the DS migration (hex ramps identical to the base)', () => {
    expect(PACKS.life.primaryColor).toBe('violet');
    expect(PACKS.life.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('createAppTheme(PACKS.life) produces the semantic ramps LifeApp renders against', () => {
    const theme = createAppTheme(PACKS.life);
    expect(theme.primaryColor).toBe('violet');
    expect(theme.colors.surface).toHaveLength(10);
    expect(theme.colors.border).toHaveLength(10);
    expect(theme.other.accent).toBe(PACKS.life.accent);
  });
});
