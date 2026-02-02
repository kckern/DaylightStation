// tests/isolated/domain/content/services/CanvasSelectionService.test.mjs
import { describe, it, expect } from 'vitest';
import { CanvasSelectionService } from '#domains/content/services/CanvasSelectionService.mjs';

describe('CanvasSelectionService', () => {
  const service = new CanvasSelectionService();

  const mockItems = [
    { id: '1', category: 'landscapes', tags: ['morning', 'bright'], artist: 'Monet' },
    { id: '2', category: 'abstract', tags: ['evening', 'calm'], artist: 'Kandinsky' },
    { id: '3', category: 'landscapes', tags: ['night', 'dark'], artist: 'Van Gogh' },
    { id: '4', category: 'portraits', tags: ['morning', 'warm'], artist: 'Rembrandt' },
  ];

  describe('selectForContext', () => {
    it('filters by category', () => {
      const context = { categories: ['landscapes'] };
      const result = service.selectForContext(mockItems, context);
      expect(result).toHaveLength(2);
      expect(result.every(i => i.category === 'landscapes')).toBe(true);
    });

    it('filters by tags', () => {
      const context = { tags: ['morning'] };
      const result = service.selectForContext(mockItems, context);
      expect(result).toHaveLength(2);
      expect(result.map(i => i.id)).toEqual(['1', '4']);
    });

    it('combines category and tag filters (AND)', () => {
      const context = { categories: ['landscapes'], tags: ['morning'] };
      const result = service.selectForContext(mockItems, context);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('returns all items when no filters', () => {
      const result = service.selectForContext(mockItems, {});
      expect(result).toHaveLength(4);
    });
  });

  describe('pickNext', () => {
    it('picks random item from pool', () => {
      const result = service.pickNext(mockItems, [], { mode: 'random' });
      expect(mockItems).toContainEqual(result);
    });

    it('avoids items in shownHistory', () => {
      const shownHistory = ['1', '2', '3'];
      const result = service.pickNext(mockItems, shownHistory, { mode: 'random' });
      expect(result.id).toBe('4');
    });

    it('resets when all items shown', () => {
      const shownHistory = ['1', '2', '3', '4'];
      const result = service.pickNext(mockItems, shownHistory, { mode: 'random' });
      expect(mockItems).toContainEqual(result);
    });

    it('picks sequentially when mode is sequential', () => {
      const shownHistory = ['1'];
      const result = service.pickNext(mockItems, shownHistory, { mode: 'sequential' });
      expect(result.id).toBe('2');
    });

    it('returns null for empty pool', () => {
      const result = service.pickNext([], [], { mode: 'random' });
      expect(result).toBeNull();
    });
  });

  describe('buildContextFilters', () => {
    it('merges time, calendar, and device contexts', () => {
      const timeContext = { tags: ['morning'] };
      const calendarContext = { tags: ['holiday'] };
      const deviceContext = { categories: ['landscapes'], frameStyle: 'ornate' };
      const result = service.buildContextFilters(timeContext, calendarContext, deviceContext);
      expect(result.tags).toEqual(['morning', 'holiday']);
      expect(result.categories).toEqual(['landscapes']);
      expect(result.frameStyle).toBe('ornate');
    });

    it('device overrides calendar overrides time', () => {
      const timeContext = { frameStyle: 'classic' };
      const calendarContext = { frameStyle: 'minimal' };
      const deviceContext = { frameStyle: 'ornate' };
      const result = service.buildContextFilters(timeContext, calendarContext, deviceContext);
      expect(result.frameStyle).toBe('ornate');
    });
  });
});
