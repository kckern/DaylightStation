import { it, expect } from 'vitest';
import { foodOperationScope } from './foodOperationScope.js';
it('includes group descendants and source/destination membership dependencies without unrelated foods', () => {
 const rows = [{ uuid:'g',kind:'group' }, { uuid:'a',parentId:'g' }, { uuid:'h',kind:'group' }, {uuid:'b',parentId:'h'}, {uuid:'c'}];
 expect(foodOperationScope({ action:'membership',rows,selectedIds:['a'],groupId:'g',destinationGroupId:'h' })).toEqual(['a','b','g','h']);
 expect(foodOperationScope({ action:'edit',rows,selectedIds:['c'] })).toEqual(['c']);
 expect(foodOperationScope({ action:'edit',rows,selectedIds:['g'] })).toEqual(['a','g']);
});

it('resolves legacy parent aliases to canonical UUID reservations',()=>{
 const rows=[{uuid:'canonical',id:7,kind:'group'},{uuid:'child',parentId:7},{uuid:'unrelated'}];
 expect(foodOperationScope({action:'edit',rows,selectedIds:['canonical']})).toEqual(['canonical','child']);
 expect(foodOperationScope({action:'membership',rows,selectedIds:['child']})).toEqual(['canonical','child']);
});
