import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
/** Platform crypto stays outside the application workflow. */
export function createApprovalTokenPrimitives(){
  const hashNonce=value=>createHash('sha256').update(value).digest('hex');
  return {makeNonce:()=>randomBytes(32).toString('base64url'),hashNonce,
    nonceMatches:(expected,nonce)=>typeof expected==='string' && /^[a-f0-9]{64}$/.test(expected) && typeof nonce==='string' && timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(hashNonce(nonce),'hex'))};
}
