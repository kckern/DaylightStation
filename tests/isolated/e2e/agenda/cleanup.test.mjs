import {it,expect,vi} from 'vitest';
import {attemptCleanup,withCleanup} from '../../../live/flow/agenda/cleanup.mjs';
it('attempts every owned cleanup and preserves the original failure',async()=>{
 const first=vi.fn(async()=>{throw Error('plan cleanup');}),second=vi.fn(async()=>{}),third=vi.fn(async()=>{throw Error('series cleanup');});
 await expect(attemptCleanup([first,second,third])).rejects.toThrow();expect(second).toHaveBeenCalledOnce();expect(third).toHaveBeenCalledOnce();
 const original=Error('journey failed');let caught;
 try {await withCleanup(async()=>{throw original;},async()=>{throw Error('cleanup failed');});} catch(error){caught=error;}
 expect(caught).toBe(original);expect(caught.cleanupError).toBeInstanceOf(Error);
});
