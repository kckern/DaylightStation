import { describe, it, expect } from '@jest/globals';
import { ISource, isSource } from '#apps/newsreporter/ports/ISource.mjs';
import { ISink, isSink } from '#apps/newsreporter/ports/ISink.mjs';
import { IReportRunHistory, isReportRunHistory } from '#apps/newsreporter/ports/IReportRunHistory.mjs';

describe('newsreporter ports', () => {
  it('ISource.gather throws when not implemented', async () => {
    await expect(new ISource().gather({})).rejects.toThrow('must be implemented');
  });
  it('isSource detects a valid impl', () => {
    expect(isSource({ gather: () => {} })).toBe(true);
    expect(isSource({})).toBe(false);
  });
  it('ISink.emit throws when not implemented', async () => {
    await expect(new ISink().emit([], {}, {})).rejects.toThrow('must be implemented');
  });
  it('isSink detects a valid impl', () => {
    expect(isSink({ emit: () => {} })).toBe(true);
    expect(isSink({})).toBe(false);
  });
  it('IReportRunHistory.record throws when not implemented', async () => {
    await expect(new IReportRunHistory().record('id', {})).rejects.toThrow('must be implemented');
  });
  it('isReportRunHistory detects a valid impl', () => {
    expect(isReportRunHistory({ record: () => {} })).toBe(true);
    expect(isReportRunHistory({})).toBe(false);
  });
});
