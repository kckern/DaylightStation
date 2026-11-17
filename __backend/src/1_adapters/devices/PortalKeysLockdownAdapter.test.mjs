import {describe,it,expect,vi} from 'vitest';
import {PortalKeysLockdownAdapter} from './PortalKeysLockdownAdapter.mjs';

const logger={info(){}};
const response=body=>({ok:true,json:async()=>body});
function adapter(body,extra={}){
  return new PortalKeysLockdownAdapter({baseUrl:'http://portal.test:8771/',token:'fixture-secret',logger,fetchFn:vi.fn(async()=>response(body)),...extra});
}

describe('Portal Keys lockdown capability',()=>{
  it('missing credentials never contact the native service',async()=>{
    const fetchFn=vi.fn();
    const adapterWithoutToken=adapter(null,{token:null,fetchFn});
    expect(await adapterWithoutToken.setLockdown({locked:true})).toMatchObject({ok:false,skipped:true});
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await adapterWithoutToken.setLockdown({locked:true})).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    expect(await adapterWithoutToken.probe()).toEqual({capabilities:[],error:'CAPABILITY_UNAVAILABLE'});
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await adapter(null,{baseUrl:null,fetchFn}).release({commandRevision:7})).toMatchObject({ok:false,skipped:true,code:'CAPABILITY_UNAVAILABLE'});
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('protocol 1 and wrong revisions cannot acknowledge protocol 2 Stop',async()=>{
    const protocol1Adapter=adapter({lockdownActive:true,lockdownProtocolVersion:1,lockdownRevision:7});
    const wrongRevisionAdapter=adapter({lockdownActive:true,lockdownProtocolVersion:2,lockdownRevision:6});
    await expect(protocol1Adapter.stop({commandRevision:7})).rejects.toMatchObject({code:'NATIVE_ACK_MISMATCH'});
    await expect(wrongRevisionAdapter.stop({commandRevision:7})).rejects.toMatchObject({code:'NATIVE_ACK_MISMATCH'});
  });
  it('acknowledges exact ordered Stop and release and preserves legacy deadlines',async()=>{
    const fetchFn=vi.fn(async(_url,request)=>{
      const body=JSON.parse(request.body);
      return response({lockdownActive:body.locked,lockdownProtocolVersion:2,lockdownRevision:body.revision});
    });
    const native=adapter(null,{fetchFn});
    expect(await native.stop({commandRevision:7})).toEqual({ok:true,blocked:true,commandRevision:7});
    expect(await native.release({commandRevision:8})).toEqual({ok:true,blocked:false,commandRevision:8});
    expect(await native.setLockdown({locked:true,lockedUntil:'2026-11-16T12:30:00.000Z'})).toEqual({ok:true,blocked:true,commandRevision:null});
    expect(fetchFn.mock.calls.map(([url,request])=>({url,token:request.headers['X-Lockdown-Token'],body:JSON.parse(request.body)}))).toEqual([
      {url:'http://portal.test:8771/lockdown',token:'fixture-secret',body:{locked:true,lockedUntil:null,revision:7}},
      {url:'http://portal.test:8771/lockdown',token:'fixture-secret',body:{locked:false,lockedUntil:null,revision:8}},
      {url:'http://portal.test:8771/lockdown',token:'fixture-secret',body:{locked:true,lockedUntil:1794832200000}},
    ]);
  });
  it('HTTP rejection and mismatched blocked state are never successful acknowledgements',async()=>{
    await expect(adapter(null,{fetchFn:async()=>({ok:false,status:403})}).stop({commandRevision:7})).rejects.toMatchObject({code:'NATIVE_LOCKDOWN_REJECTED',contacted:true});
    await expect(adapter({lockdownActive:false,lockdownProtocolVersion:2,lockdownRevision:7}).stop({commandRevision:7})).rejects.toMatchObject({code:'NATIVE_ACK_MISMATCH',contacted:true});
  });
  it('unreachable commands and malformed acknowledgements cannot verify enforcement',async()=>{
    await expect(adapter(null,{fetchFn:async()=>{throw new TypeError('offline');}}).stop({commandRevision:7})).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    await expect(adapter(null).stop({commandRevision:7})).rejects.toMatchObject({code:'NATIVE_ACK_MISMATCH',contacted:true});
    await expect(adapter(null,{fetchFn:async()=>({ok:true,json:async()=>{throw new SyntaxError('bad JSON');}})}).stop({commandRevision:7})).rejects.toMatchObject({code:'NATIVE_ACK_MISMATCH',contacted:true});
  });
  it.each([
    null,
    {serviceBound:'true',config:{lockdownProtocolVersion:2}},
    {serviceBound:false,config:{lockdownProtocolVersion:2}},
    {serviceBound:true,config:{lockdownProtocolVersion:1}},
    {serviceBound:true},
  ])('reports missing native service or protocol as unavailable: %j',async body=>{
    expect(await adapter(body).probe()).toMatchObject({capabilities:[],error:'CAPABILITY_UNAVAILABLE'});
  });
  it('advertises portal-keys only for a bound protocol 2 service',async()=>{
    expect(await adapter({serviceBound:true,config:{lockdownProtocolVersion:2,lockdownActive:true,lockdownRevision:7}}).probe()).toEqual({capabilities:['portal-keys'],locked:true,commandRevision:7});
  });
  it('reports unreachable and rejected probes with a stable unavailable code',async()=>{
    await expect(adapter(null,{fetchFn:async()=>{throw new TypeError('offline');}}).probe()).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    await expect(adapter(null,{fetchFn:async()=>({ok:false,status:503})}).probe()).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
    await expect(adapter(null,{fetchFn:async()=>({ok:true,json:async()=>{throw new SyntaxError('bad JSON');}})}).probe()).rejects.toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  });
});
