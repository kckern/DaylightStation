import { randomBytes as secureBytes } from 'node:crypto';
const ACTIONS=Object.freeze({yes:'y',not_yet:'n',drop:'d',skip:'s',looks_right:'l',confirm:'c',reject:'r',done:'x'});
const BY_CODE=Object.fromEntries(Object.entries(ACTIONS).map(([action,code])=>[code,action]));
const NONCE=/^[A-Za-z0-9_-]{22}$/;
/** Opaque ids carry no authority; principal, scope and ACK binding are separate. */
export function createKnowledgeCallbackTokens({randomBytes=secureBytes}={}) {
  return Object.freeze({
    mint(){const bytes=randomBytes(16);if(!Buffer.isBuffer(bytes)||bytes.length!==16)throw new TypeError('Invalid callback entropy');return bytes.toString('base64url');},
    encode({nonce,action}){if(!NONCE.test(nonce??'')||!Object.hasOwn(ACTIONS,action))throw new TypeError('Invalid callback token');return `kb1:${nonce}:${ACTIONS[action]}`;},
    decode(raw){
      if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>64)return null;
      const match=/^kb1:([A-Za-z0-9_-]{22}):([yndslcrx])$/.exec(raw);
      return match?{nonce:match[1],action:BY_CODE[match[2]]}:null;
    },
  });
}
