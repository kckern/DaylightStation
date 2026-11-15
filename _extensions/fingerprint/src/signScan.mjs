import {createHmac,randomUUID} from 'node:crypto';
/** Add before sending a biometric.scan envelope; the secret stays on the reader. */
export function signScan(message,{secret,id='garage-reader',now=()=>Date.now(),makeId=randomUUID}){
  if(typeof secret!=='string' || secret.length<32)throw new TypeError('SCANNER_SIGNING_SECRET must have at least 32 characters');
  const scanner={id,at:now(),nonce:makeId()},data={modality:message.modality,matched:message.matched,uuid:message.uuid??null};
  const signature=createHmac('sha256',secret).update(JSON.stringify({topic:message.topic,data,scanner})).digest('hex');
  return {...message,scanner,signature};
}
