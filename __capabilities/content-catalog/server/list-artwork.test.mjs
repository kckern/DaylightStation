import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createListArtworkResolver} from './list-artwork.mjs';

it('returns UID artwork only when its file exists and rejects traversal', async () => {
 const dir=mkdtempSync(join(tmpdir(),'list-art-'));
 try {
  mkdirSync(join(dir,'img','lists'),{recursive:true});writeFileSync(join(dir,'img','lists','existing.jpg'),'image');
  const resolve=createListArtworkResolver({mediaDir:dir});
  await expect(resolve({householdId:'h',item:{uid:'existing'}})).resolves.toBe('/media/img/lists/existing.jpg');
  await expect(resolve({householdId:'h',item:{uid:'missing'}})).resolves.toBeNull();
  await expect(resolve({householdId:'h',item:{uid:'../bad'}})).rejects.toMatchObject({code:'invalid_id'});
 } finally {rmSync(dir,{recursive:true,force:true});}
});
