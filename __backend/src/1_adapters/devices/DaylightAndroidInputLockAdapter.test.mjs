import {describe, expect, it, vi} from 'vitest';
import {ShutdownService} from '../../3_applications/shutdown/ShutdownService.mjs';
import {createPortalInputLock} from '../../5_composition/modules/supervision.mjs';

function fixture(provider) {
  const httpClient = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
  const fetchFn = vi.fn();
  const configService = {
    getDeviceConfig: () => ({content_control: {provider, host:'portal.test', auth_ref:'android'}}),
    getHouseholdAuth: ref => ref === 'android' ? {portal:{token:'fixture'}} : {token:'legacy'},
  };
  const actuator = createPortalInputLock({configService, deviceId:'portal', portalKeys:{base_url:'http://legacy.test',auth_ref:'keys'},httpClient,fetchFn,logger:{}});
  return {actuator, httpClient, fetchFn};
}
describe('Portal input lock selection at startup', () => {
  it('sends ordered commands and timed shutdown reconciliation to Daylight Android', async () => {
    const {actuator,httpClient,fetchFn} = fixture('daylight-android');
    let revision = 0;
    httpClient.post.mockImplementation(async (url,body,config) => {
      expect(url).toBe('http://portal.test:8780/lockdown/input');
      expect(config.headers['X-Daylight-Token']).toBe('fixture');
      if ((body.revision ?? 0) < revision) return {status:409,data:{ok:false}};
      revision = body.revision ?? 0;
      return {data:{ok:true,inputReady:true,inputLocked:body.locked,revision}};
    });
    const until = Date.now()+60000;
    await actuator.setLockdown({locked:true,lockedUntil:new Date(until).toISOString()});
    expect(httpClient.post.mock.calls[0][1]).toEqual({locked:true,lockedUntil:until});
    for(const i of [11,11]) expect(await actuator.stop({commandRevision:i})).toEqual({ok:true,blocked:true,commandRevision:i});
    await expect(actuator.release({commandRevision:10})).rejects.toThrow();
    for(const i of [12,12]) expect(await actuator.release({commandRevision:i})).toEqual({ok:true,blocked:false,commandRevision:i});
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it.each(['daylight-android','fully-kiosk'])('reconciles shutdown and expiry using %s', async provider => {
    const {actuator,httpClient,fetchFn} = fixture(provider);
    httpClient.post.mockImplementation(async (_,body) => ({data:{ok:true,inputReady:true,inputLocked:body.locked,revision:0}}));
    fetchFn.mockImplementation(async (_,options) => ({ok:true,json:async()=>({lockdownActive:JSON.parse(options.body).locked})}));
    let state;
    const now = Date.now();
    const service = new ShutdownService({
      repo:{save:async value=>{state=value;},read:async()=>({state})},
      getPolicy:()=>({targets:['school:portal'],durationSeconds:60}),
      notifier:{publishState(){}}, portal:actuator, logger:{},
    });
    await service.activate({tagUid:'fixture',now});
    await service.reconcile(now+1000);
    expect((await service.diagnostics(now+1000)).enforcement.consumers[0]).toMatchObject({blocked:true,acknowledged:true});
    await service.reconcile(now+61000);
    expect((await service.diagnostics(now+61000)).enforcement.consumers[0]).toMatchObject({blocked:false,acknowledged:true});
    expect(httpClient.post).toHaveBeenCalledTimes(provider === 'daylight-android' ? 3 : 0);
    expect(fetchFn).toHaveBeenCalledTimes(provider === 'fully-kiosk' ? 3 : 0);
  });
  it('requires evidence of the bound filter and matching revision', async () => {
    const {actuator,httpClient} = fixture('daylight-android');
    for(const data of [{inputReady:false,inputLocked:true,revision:11},{inputReady:true,inputLocked:true,revision:10},{inputReady:true,inputLocked:false,revision:11}]) {
      httpClient.post.mockResolvedValue({data:{ok:true,...data}});
      await expect(actuator.stop({commandRevision:11})).rejects.toThrow();
    }
    httpClient.post.mockRejectedValue(new Error('offline'));
    await expect(actuator.stop({commandRevision:11})).rejects.toThrow();
    httpClient.get.mockResolvedValue({data:{ok:true,locked:true,inputLock:{inputReady:false}}});
    expect((await actuator.probe()).capabilities).toEqual([]);
    httpClient.get.mockResolvedValue({data:{ok:true,inputLock:{inputReady:true,inputLocked:false,revision:12}}});
    expect(await actuator.probe()).toEqual({capabilities:['portal-keys'],locked:false,commandRevision:12});
  });
  it('reports unsupported providers unavailable without contacting either actuator', async () => {
    const {actuator,fetchFn,httpClient} = fixture('unsupported-provider');
    expect(await actuator.stop({commandRevision:11})).toMatchObject({ok:false,code:'CAPABILITY_UNAVAILABLE'});
    expect((await actuator.probe()).capabilities).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(httpClient.get).not.toHaveBeenCalled();
    expect(httpClient.post).not.toHaveBeenCalled();
  });
  it.each(['fully-kiosk',undefined])('uses the legacy PUT with provider %s', async provider => {
    const {actuator,fetchFn,httpClient} = fixture(provider);
    fetchFn.mockImplementation(async (_,options) => {
      expect(options.method).toBe('PUT');
      const {locked,revision} = JSON.parse(options.body);
      return {ok:true,json:async()=>({lockdownActive:locked,lockdownProtocolVersion:2,lockdownRevision:revision})};
    });
    for(const i of [11,11]) await actuator.stop({commandRevision:i});
    for(const i of [12,12]) await actuator.release({commandRevision:i});
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(httpClient.post).not.toHaveBeenCalled();
  });
});
