import { describe, it, expect } from 'vitest';
import { artworkQueueKey, backoffMs, BACKOFF_CEILING_MS, isDue, mergeArtworkReport, recordArtworkFailure,
  resolveArtworkItem, queueView, isArtworkKind } from './artworkQueue.mjs';
import { isExactOnlyName } from './icons.mjs';

const T0 = Date.parse('2026-09-23T10:00:00Z');
const iso = ms => new Date(ms).toISOString();

describe('artwork queue policy', () => {
  it('keys icon kinds by food, then name, and photos by photoRef', () => {
    expect(artworkQueueKey({ kind: 'icon-missing', foodId: 'f1', name: 'Eggs' })).toBe('food:f1');
    expect(artworkQueueKey({ kind: 'icon-failed', name: '  Strawberry  Milkshake!' })).toBe('name:strawberry milkshake');
    expect(artworkQueueKey({ kind: 'icon-failed', icon: 'apple' })).toBe('icon:apple');
    expect(artworkQueueKey({ kind: 'photo-failed', photoRef: 'ph_x', foodId: 'f1' })).toBe('photo:ph_x');
    expect(artworkQueueKey({ kind: 'photo-failed', foodId: 'f1' })).toBeNull();
    expect(isArtworkKind('icon-missing')).toBe(true);
    expect(isArtworkKind('icon')).toBe(false);
  });

  it('backs off from 1 minute, doubling, to a 24 h ceiling — and never stops', () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(120_000);
    expect(backoffMs(5)).toBe(16 * 60_000);
    expect(backoffMs(12)).toBe(BACKOFF_CEILING_MS);
    expect(backoffMs(500)).toBe(BACKOFF_CEILING_MS);
  });

  it('a new report creates a due item; a repeat adds rows without resetting the wait', () => {
    const { item, created } = mergeArtworkReport(null, { key: 'food:f1', kind: 'icon-missing', foodId: 'f1', name: 'Eggs', rowIds: ['r1'] }, iso(T0));
    expect(created).toBe(true);
    expect(isDue(item, T0)).toBe(true);
    const failed = recordArtworkFailure(item, 'no fit', T0);
    expect(failed).toMatchObject({ attempts: 1, lastError: 'no fit', nextAttemptAt: iso(T0 + 60_000) });
    expect(isDue(failed, T0 + 1000)).toBe(false);
    const again = mergeArtworkReport(failed, { key: 'food:f1', kind: 'icon-missing', rowIds: ['r2', 'r1'] }, iso(T0 + 5000));
    expect(again.item.rowIds).toEqual(['r1', 'r2']);
    expect(again.item.nextAttemptAt).toBe(iso(T0 + 60_000));
    expect(again.reopened).toBe(false);
  });

  it('a report on a resolved item reopens it, due now', () => {
    const { item } = mergeArtworkReport(null, { key: 'photo:ph_x', kind: 'photo-failed', photoRef: 'ph_x', rowIds: ['r1'] }, iso(T0));
    const done = resolveArtworkItem(item, { via: 'icon', icon: 'apple', rows: 1 }, T0);
    expect(isDue(done, T0 + 10 ** 9)).toBe(false);
    const { item: back, reopened } = mergeArtworkReport(done, { key: 'photo:ph_x', kind: 'photo-failed', rowIds: ['r3'], error: 'load' }, iso(T0 + 1000));
    expect(reopened).toBe(true);
    expect(back).toMatchObject({ resolvedAt: null, resolution: null, nextAttemptAt: iso(T0 + 1000), lastError: 'load' });
  });

  it('views open items soonest-due first and a few recent resolutions', () => {
    const a = { key: 'a', nextAttemptAt: iso(T0 + 2), resolvedAt: null };
    const b = { key: 'b', nextAttemptAt: iso(T0 + 1), resolvedAt: null };
    const c = { key: 'c', resolvedAt: iso(T0) };
    const d = { key: 'd', resolvedAt: iso(T0 + 5) };
    expect(queueView({ a, b, c, d }, { resolvedLimit: 1 })).toEqual({ open: [b, a], recentlyResolved: [d] });
  });

  it('names exact-only foods', () => {
    expect(isExactOnlyName('Oikos Pro Plain')).toBe(true);
    expect(isExactOnlyName('Strawberry Milkshake')).toBe(false);
  });
});
