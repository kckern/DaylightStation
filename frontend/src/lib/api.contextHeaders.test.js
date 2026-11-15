import {it,expect,vi,afterEach} from 'vitest';
import {DaylightAPI} from './api.mjs';
import {setRequestContextHeaders} from './requestContextHeaders.mjs';
afterEach(()=>{setRequestContextHeaders('supervision',null);vi.unstubAllGlobals();localStorage.clear();});
it('activity session metadata reaches direct API calls and clears on teardown',async()=>{
 const fetch=vi.fn(async()=>({ok:true,status:200,json:async()=>({ok:true})}));vi.stubGlobal('fetch',fetch);
 setRequestContextHeaders('supervision',{'X-Supervision-Request':'request-1','X-Supervision-Session':'server-session','X-Supervision-Learner':'user_5'});
 await DaylightAPI('api/v1/launch',{contentId:'arcade:test'},'POST');expect(fetch.mock.calls[0][1].headers).toMatchObject({'X-Supervision-Request':'request-1','X-Supervision-Session':'server-session'});
 setRequestContextHeaders('supervision',null);await DaylightAPI('api/v1/launch',{contentId:'arcade:other'},'POST');expect(fetch.mock.calls[1][1].headers['X-Supervision-Session']).toBeUndefined();
});
