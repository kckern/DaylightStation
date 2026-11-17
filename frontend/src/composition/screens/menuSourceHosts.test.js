import {it,expect,vi} from 'vitest';
import {resolveMenuSource} from './menuSourceHosts.js';
import {DaylightAPI} from '../../lib/api.mjs';
vi.mock('../../lib/api.mjs',async original=>({...await original(),DaylightAPI:vi.fn()}));
it('resolves claimed aliases exactly and leaves unclaimed aliases ordinary',async()=>{
 DaylightAPI.mockResolvedValueOnce({alias:{owner:'agenda',canonicalContentId:'agenda:neutral'}}).mockResolvedValueOnce({alias:null});
 expect((await resolveMenuSource('menu:neutral')).contentId).toBe('agenda:neutral');expect(await resolveMenuSource('menu:ordinary')).toBeNull();
});
it('fails closed on malformed ownership instead of falling back',async()=>{
 DaylightAPI.mockResolvedValueOnce({alias:{owner:'agenda',canonicalContentId:'agenda:neutral',extra:true}});
 await expect(resolveMenuSource('menu:neutral')).rejects.toThrow('Invalid ownership response');
});
