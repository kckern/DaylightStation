import { describe, it, expect } from 'vitest';
import { buildScalePromptText } from '#apps/nutribot/usecases/LogFoodFromScale.mjs';

describe('buildScalePromptText', () => {
  it('shows gross only when nothing is tared', () => {
    const text = buildScalePromptText({ gross: 420, composition: { container: null } }, { items: [] });
    expect(text).toContain('420');
    expect(text).not.toMatch(/net/i);
  });

  it('matches the legacy slim prompt exactly when there is no composition at all', () => {
    // The pre-existing prompt body was `⚖️ ${grams} g` and the Jest suite pins it.
    expect(buildScalePromptText({ gross: 340 })).toBe('⚖️ 340 g');
  });

  it('names the container and shows the net once a tare is scanned', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'mug' } },
      { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    );
    expect(text).toContain('☕ Mug');
    expect(text).toContain('350');
    expect(text).toMatch(/70\s*g/); // 420 gross - 350 tare
  });

  it('never reports a negative net when the tare outweighs the gross', () => {
    const text = buildScalePromptText(
      { gross: 100, composition: { container: 'mug' } },
      { items: [{ id: 'mug', label: 'Mug', emoji: '☕', grams: 350 }] },
    );
    expect(text).toContain('= 0 g net');
  });

  it('flags a container that is no longer in config rather than dropping it', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'teapot' } },
      { items: [] },
    );
    expect(text).toMatch(/unknown container/i);
    expect(text).toContain('teapot');
  });

  it('falls back to the container id when it carries no label', () => {
    const text = buildScalePromptText(
      { gross: 420, composition: { container: 'jar' } },
      { items: [{ id: 'jar', grams: 200 }] },
    );
    expect(text).toContain('jar');
    expect(text).toContain('= 220 g net');
  });
});
