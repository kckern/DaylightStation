import { expect, it } from 'vitest';
import { normalizeListItem } from './listItemInput.mjs';

it('preserves a canonical action alongside an independent label', () => {
  const item = { title: 'Catalog title', label: 'Weekly label', play: { contentId: 'music:one' } };
  expect(normalizeListItem(item)).toMatchObject(item);
});
it.each(['', undefined])('retains legacy handling when input is explicitly %s', input => {
  const result = normalizeListItem({title:'Catalog',label:'Label',input,play:{contentId:'stale'}});
  expect(result).toMatchObject({title:'Catalog',label:'Label'});
  expect(result.play).toBeUndefined();
});
it('normalizes an authored space after a hyphenated source name', async () => {
  const { listItemParts } = await import('./listItemProjection.mjs');
  const parts = listItemParts(normalizeListItem({ label: 'NFL Channel', input: 'plex-live: nfl-channel' }));
  expect(parts.contentId).toBe('plex-live:nfl-channel');
  expect(parts.source).toBe('plex-live');
  expect(parts.localId).toBe('nfl-channel');
  expect(parts.playAction).toMatchObject({ 'plex-live': 'nfl-channel' });
});
it('keeps object params on a legacy item', () => {
  const params = { autostart: false };
  expect(normalizeListItem({ label: 'L', input: 'app:party-games/charades:fhe', params }).params).toEqual(params);
});
const legacyItem = params => ({ label: 'L', input: 'app:party-games/charades:fhe', params });
const canonicalItem = params => ({ title: 'C', open: 'party-games/charades', params });
class ParamsHolder { constructor() { this.autostart = true; } }
const rejectedParams = [
  ['null', null], ['an array', ['x']], ['an empty object', {}], ['a string', 'nope'],
  ['a Date', new Date(0)], ['a Map', new Map([['autostart', true]])], ['a class instance', new ParamsHolder()],
];
it.each(rejectedParams)('drops %s params on a legacy item', (_name, params) => {
  expect(Object.hasOwn(normalizeListItem(legacyItem(params)), 'params')).toBe(false);
});
it.each(rejectedParams)('drops %s params on a canonical item', (_name, params) => {
  expect(Object.hasOwn(normalizeListItem(canonicalItem(params)), 'params')).toBe(false);
});
it('keeps plain-object params on a canonical item', () => {
  expect(normalizeListItem(canonicalItem({ autostart: true })).params).toEqual({ autostart: true });
});
