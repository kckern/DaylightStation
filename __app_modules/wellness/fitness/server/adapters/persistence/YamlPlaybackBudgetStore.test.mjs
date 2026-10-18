import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlPlaybackBudgetStore } from './YamlPlaybackBudgetStore.mjs';
it('preserves devices, persists across instances, and refuses corrupt records', async () => {
 const dir=mkdtempSync(path.join(tmpdir(),'playback-budget-'));
 try {
 const configService={getHouseholdPath:()=>dir};const key={householdId:'test',deviceId:'tv',localDate:'2026-10-18'};
 const store=new YamlPlaybackBudgetStore({configService});
 expect(await store.load(key)).toBeNull();
 await store.save({...key,value:{policies:{spent:123}}});
 await store.save({...key,deviceId:'other',value:{policies:{spent:456}}});
 expect(await new YamlPlaybackBudgetStore({configService}).load(key)).toEqual({policies:{spent:123}});
 writeFileSync(path.join(dir,'2026-10-18.yml'),'schema: fitness.playback-budgets/v1\nlocalDate: "2026-10-18"\ndevices:\n  tv: null\n');
 await expect(store.load(key)).rejects.toThrow();
 writeFileSync(path.join(dir,'2026-10-18.yml'),'schema: wrong');
 await expect(store.load(key)).rejects.toThrow();
 await expect(store.save({...key,value:{}})).rejects.toThrow();
 writeFileSync(path.join(dir,'2026-10-18.yml'),'[broken:');
 await expect(store.load(key)).rejects.toThrow();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
