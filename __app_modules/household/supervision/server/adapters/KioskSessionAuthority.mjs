import {createHash,timingSafeEqual} from 'node:crypto';
import {signToken,verifyToken} from '#system/auth/jwt.mjs';
import {AccessDenied} from '../../shared/contracts.mjs';
const digest=value=>createHash('sha256').update(value).digest();
export class KioskSessionAuthority {
  #household;#secret;#devices;#clock;#makeId;#delegations;
  constructor({householdId,secret,devices,clock,makeId,delegations={}}){
    if(typeof secret!=='string' || secret.length<32 || !householdId || !clock?.now || !makeId)throw new TypeError('Kiosk authority configuration required');
    for(const device of Object.values(devices??{}))if(typeof device.credential!=='string' || device.credential.length<32)throw new TypeError('Registered kiosk credential must have at least 32 characters');
    this.#household=householdId;this.#secret=secret;this.#devices=devices;this.#clock=clock;this.#makeId=makeId;this.#delegations=delegations;
  }
  async issue({deviceId,credential,sessionId=this.#makeId()}){
    const registered=this.#devices?.[deviceId];
    if(!registered || typeof credential!=='string' || !timingSafeEqual(digest(credential),digest(registered.credential)))throw new AccessDenied('KIOSK_AUTHENTICATION_REQUIRED');
    const now=Math.floor(this.#clock.now()/1000);
    const token=signToken({sub:deviceId,hid:this.#household,kind:'kiosk',sid:sessionId,keyVersion:digest(registered.credential).toString('hex'),iat:now},this.#secret,{issuer:'daylight-supervision',audience:'daylight-kiosk',algorithm:'HS256',expiresIn:600});
    return {token,sessionId,expiresAt:(now+600)*1000};
  }
  provision({deviceId}){
    const device=this.#devices[deviceId];if(!device)throw new AccessDenied('KIOSK_TARGET_NOT_AUTHORIZED');
    const now=Math.floor(this.#clock.now()/1000);
    return signToken({sub:deviceId,hid:this.#household,kind:'kiosk-bootstrap',sid:this.#makeId(),keyVersion:digest(device.credential).toString('hex'),iat:now},this.#secret,{issuer:'daylight-supervision',audience:'daylight-kiosk-provisioning',algorithm:'HS256',expiresIn:2592000});
  }
  async renew(request){
    const token=request.headers?.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('daylight_kiosk_bootstrap='))?.slice('daylight_kiosk_bootstrap='.length);
    const claims=typeof token==='string'?verifyToken(token,this.#secret,{issuer:'daylight-supervision',audience:'daylight-kiosk-provisioning',algorithms:['HS256'],clockTimestamp:Math.floor(this.#clock.now()/1000)}):null;
    const device=claims && this.#devices[claims.sub];
    if(!device || claims.kind!=='kiosk-bootstrap' || claims.hid!==this.#household || claims.keyVersion!==digest(device.credential).toString('hex'))throw new AccessDenied('KIOSK_AUTHENTICATION_REQUIRED');
    return {...await this.issue({deviceId:claims.sub,credential:device.credential,sessionId:claims.sid}),deviceId:claims.sub};
  }
  async authenticate(request){
    const cookie=request.headers?.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('daylight_kiosk='))?.slice('daylight_kiosk='.length);
    const token=request.headers?.['x-kiosk-session']??cookie;
    const claims=typeof token==='string'?verifyToken(token,this.#secret,{issuer:'daylight-supervision',audience:'daylight-kiosk',algorithms:['HS256'],clockTimestamp:Math.floor(this.#clock.now()/1000)}):null;
    const registered=claims && this.#devices?.[claims.sub];
    if(!registered || claims.hid!==this.#household || claims.kind!=='kiosk' || !claims.sid || claims.keyVersion!==digest(registered.credential).toString('hex'))throw new AccessDenied('KIOSK_AUTHENTICATION_REQUIRED');
    return {deviceId:claims.sub,sessionId:claims.sid};
  }
  async resolveContext(request,{targetDeviceId,activityId,learnerId,requestId,sessionId}={}){
    const kiosk=await this.authenticate(request);const deviceId=targetDeviceId??kiosk.deviceId;
    if(deviceId!==kiosk.deviceId && !this.#delegations[kiosk.deviceId]?.includes(deviceId))throw new AccessDenied('KIOSK_TARGET_NOT_AUTHORIZED');
    if(!this.#devices[deviceId])throw new AccessDenied('KIOSK_TARGET_NOT_AUTHORIZED');
    return {deviceId,activityId,learnerId:learnerId===null?null:learnerId??request.headers?.['x-supervision-learner'],requestId:requestId??request.headers?.['x-supervision-request'],sessionId:sessionId??request.headers?.['x-supervision-session'],clientSessionId:kiosk.sessionId};
  }
}
