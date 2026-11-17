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
