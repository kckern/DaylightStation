import { expect, it, vi } from 'vitest';
import { createAgendaClient } from './agendaClient.js';
it('uses a conditional write and returns the new document and ETag',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({plan_id:'p',revision:2}),{status:200,headers:{'Content-Type':'application/json',ETag:'"two"'}}));
 const client=createAgendaClient(fetcher);
 expect(await client.savePlan('s','p',{plan_id:'p'},'"one"')).toEqual({document:{plan_id:'p',revision:2},etag:'"two"'});
 expect(fetcher.mock.calls[0][1]).toMatchObject({method:'PUT',headers:{'Content-Type':'application/json','If-Match':'"one"'},body:JSON.stringify({plan:{plan_id:'p'}})});
});
it('retains field errors and status on conflicts',async()=>{
 const client=createAgendaClient(async()=>new Response(JSON.stringify({code:'revision_conflict',errors:[{field:'plan',message:'changed'}]}),{status:409}));
 await expect(client.plan('s','p')).rejects.toMatchObject({status:409,code:'revision_conflict',errors:[{field:'plan',message:'changed'}]});
});
it('uses the canonical agenda and guest administration mounts',async()=>{
 const fetcher=vi.fn(async()=>new Response('{}',{status:200}));const client=createAgendaClient(fetcher);
 await client.series('s');await client.people();await client.createGuest({id:'v',name:'Visitor'},'"0"');
 expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/v1/admin/content/agendas/s','/api/v1/admin/people?includeArchived=true','/api/v1/admin/people/guests']);
});
it('sends shared authentication, device, context and conditional headers from the default client',async()=>{
 const {agendaClient}=await import('./agendaClient.js');
 const {setRequestContextHeaders}=await import('../../../../../frontend/src/lib/requestContextHeaders.mjs');
 localStorage.setItem('ds_token','neutral-token');window.__DAYLIGHT_DEVICE_ID='sample-screen';setRequestContextHeaders('agenda-test',{'X-Sample-Context':'sample'});
 const fetcher=vi.fn(async()=>new Response('{}',{status:200,headers:{ETag:'"next"'}}));vi.stubGlobal('fetch',fetcher);
 try {await agendaClient.savePlan('s','p',{},'"old"');expect(fetcher.mock.calls[0][1].headers).toMatchObject({Authorization:'Bearer neutral-token','X-Daylight-Device':'fleet:sample-screen','X-Sample-Context':'sample','If-Match':'"old"'});}
 finally {localStorage.removeItem('ds_token');delete window.__DAYLIGHT_DEVICE_ID;setRequestContextHeaders('agenda-test',null);vi.unstubAllGlobals();}
});

it('reads the default same-origin series URL without a JSON content type and preserves its revision', async () => {
  const fetcher = vi.fn(async () => Response.json({ series: [] }, { headers: { ETag: '"series-rev"' } }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const client = createAgendaClient();
    await expect(client.series('family/series')).resolves.toEqual({ document: { series: [] }, etag: '"series-rev"' });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(location.origin + '/api/v1/admin/content/agendas/family%2Fseries');
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.headers['If-Match']).toBeUndefined();
    expect(options.headers['X-Daylight-Device']).toBeTruthy();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('forwards the agenda read signal without changing the response envelope', async () => {
  const { signal } = new AbortController();
  const fetcher = vi.fn(async () => Response.json({}, { headers: { ETag: '"revision"' } }));
  const client = createAgendaClient(fetcher);
  const responses = await Promise.all([
    client.seriesList({ signal }),
    client.plans('family/series', { signal }),
    client.planningContext('family/series', { signal }),
    client.people({ signal }),
  ]);
  expect(responses).toEqual(Array(4).fill({ document: {}, etag: '"revision"' }));
  expect(fetcher.mock.calls.map(([url, options]) => [url, options.method])).toEqual([
    ['/api/v1/admin/content/agendas', 'GET'],
    ['/api/v1/admin/content/agendas/family%2Fseries/plans', 'GET'],
    ['/api/v1/admin/content/agendas/family%2Fseries/planning-context', 'GET'],
    ['/api/v1/admin/people?includeArchived=true', 'GET'],
  ]);
  for (const [, options] of fetcher.mock.calls) expect(options.signal).toBe(signal);
});
