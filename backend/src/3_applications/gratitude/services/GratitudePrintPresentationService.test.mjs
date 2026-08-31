import { describe, expect, it, vi } from 'vitest';
import { GratitudePrintPresentationService } from './GratitudePrintPresentationService.mjs';
import { createGratitudeCardRenderer } from '#rendering/gratitude/GratitudeCardRenderer.mjs';

const candidate = (id, category) => ({
  id,
  datetime: '2026-08-29T12:00:00.000Z',
  printCount: 0,
  displayName: 'Family',
  item: { text: `${category} ${id}` },
});

describe('GratitudePrintPresentationService', () => {
  it('selects and projects live-sized candidate pools with injected time and randomness', async () => {
    const gratitude = {
      getSelectionsForPrint: vi.fn().mockResolvedValue({
        gratitude: ['g1', 'g2', 'g3'].map((id) => candidate(id, 'gratitude')),
        hopes: ['h1', 'h2', 'h3'].map((id) => candidate(id, 'hope')),
      }),
    };
    const service = new GratitudePrintPresentationService({
      gratitude,
      resolveGroupLabel: vi.fn(),
      clock: { now: () => Date.parse('2026-08-30T12:00:00.000Z') },
      random: () => 0,
      counts: { gratitude: 2, hopes: 2 },
    });

    const result = await service.prepare('home');

    expect(result.gratitude).toHaveLength(2);
    expect(result.hopes).toHaveLength(2);
    expect(result.gratitude[0]).toEqual(expect.objectContaining({
      id: expect.any(String),
      text: expect.any(String),
    }));
  });

  it('rejects a missing random source during composition', () => {
    expect(() => new GratitudePrintPresentationService({
      gratitude: { getSelectionsForPrint: vi.fn() },
      resolveGroupLabel: vi.fn(),
      clock: { now: Date.now },
    })).toThrow('GratitudePrintPresentationService requires random');
  });

  it('feeds selected items through the production renderer', async () => {
    const presentation = new GratitudePrintPresentationService({
      gratitude: { getSelectionsForPrint: async () => ({
        gratitude: ['g1', 'g2', 'g3'].map((id) => candidate(id, 'gratitude')),
        hopes: ['h1', 'h2', 'h3'].map((id) => candidate(id, 'hope')),
      }) },
      resolveGroupLabel: () => 'Family',
      clock: { now: () => Date.parse('2026-08-30T12:00:00.000Z') },
      random: () => 0,
    });
    const renderer = createGratitudeCardRenderer({
      getSelectionsForPrint: () => presentation.prepare('home'),
    });

    const result = await renderer.createCanvas();

    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.canvas.toBuffer('image/png').length).toBeGreaterThan(0);
    expect(result.selectedIds.gratitude).toHaveLength(2);
    expect(result.selectedIds.hopes).toHaveLength(2);
  });
});
