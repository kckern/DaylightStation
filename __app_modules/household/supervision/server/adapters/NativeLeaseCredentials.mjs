import {createHash,timingSafeEqual} from 'node:crypto';
import {AccessDenied} from '../../shared/contracts.mjs';
const digest=value=>createHash('sha256').update(value).digest();
export class NativeLeaseCredentials {
  #entries;
  constructor({entries={}}){this.#entries=Object.entries(entries).filter(([,value])=>typeof value?.credential==='string' && value.credential.length>=32);}
  authenticate({credentials,packageName}){
    if(typeof credentials!=='string' || typeof packageName!=='string')throw new AccessDenied('NATIVE_AUTHENTICATION_REQUIRED');
    const hashed=digest(credentials);for(const [deviceId,value] of this.#entries)if(timingSafeEqual(hashed,digest(value.credential)) && value.packages?.includes(packageName))return {deviceId,packageName};
    throw new AccessDenied('NATIVE_AUTHENTICATION_REQUIRED');
  }
}
