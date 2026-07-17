import { describe, it, expect } from 'vitest';
import { lifeTheme } from './LifeApp.theme.js';

describe('lifeTheme', () => {
  it('is a dark, deliberate theme with card defaults', () => {
    expect(lifeTheme.primaryColor).toBe('violet');
    expect(lifeTheme.defaultRadius).toBe('md');
    // Surface/border token scales exist (10 shades each) for card layering.
    expect(lifeTheme.colors.surface).toHaveLength(10);
    expect(lifeTheme.colors.border).toHaveLength(10);
    // Paper defaults normalize the ~30 ad-hoc cards.
    expect(lifeTheme.components.Paper.defaultProps.radius).toBe('md');
    expect(lifeTheme.components.Paper.defaultProps.withBorder).toBe(true);
  });
});
