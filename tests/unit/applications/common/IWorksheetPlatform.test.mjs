import { describe, expect, it } from 'vitest';
import { IWorksheetPlatform, isWorksheetPlatform } from '#apps/common/ports/IWorksheetPlatform.mjs';

describe('IWorksheetPlatform', () => {
  it('base methods throw until implemented', async () => {
    const p = new IWorksheetPlatform();
    await expect(p.listActivities({ kind: 'maze', level: 3 })).rejects.toThrow(/implemented/);
    await expect(p.getPrintable('x')).rejects.toThrow(/implemented/);
    await expect(p.getSolution('x')).rejects.toThrow(/implemented/);
    expect(() => p.id).toThrow(/implemented/);
  });
  it('recognises a duck-typed implementation', () => {
    expect(isWorksheetPlatform({ id: 'b', listActivities() {}, getPrintable() {}, getSolution() {} })).toBe(true);
    expect(isWorksheetPlatform({ listActivities() {} })).toBe(false);
    expect(isWorksheetPlatform(null)).toBe(false);
  });
});
