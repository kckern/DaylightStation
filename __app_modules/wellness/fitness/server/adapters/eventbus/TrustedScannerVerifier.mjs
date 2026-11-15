import {createHmac,timingSafeEqual} from 'node:crypto';
/** Physical scanner provenance, independent of browser claims and bus identity labels. */
export class TrustedScannerVerifier {
  #secret;#clock;#id;#seen=new Map();#lastVerifiedAt=null;#lastRejection=null;#verified=0;
  constructor({secret,clock,id='garage-reader'}){if(typeof secret!=='string' || secret.length<32)throw new TypeError('Scanner secret required');this.#secret=secret;this.#clock=clock;this.#id=id;}
  health(){return {configured:true,protocol:1,lastVerifiedAt:this.#lastVerifiedAt,verifiedScans:this.#verified,lastRejection:this.#lastRejection?{...this.#lastRejection}:null};}
  #reject(reason){this.#lastRejection={reason,at:this.#clock.now()};return false;}
  accept(message){
    const now=this.#clock.now(),scanner=message?.scanner;
    if(message?.topic!=='biometric.scan' || scanner?.id!==this.#id || typeof scanner.nonce!=='string' || scanner.nonce.length>128 || !scanner.nonce || !Number.isSafeInteger(scanner.at) || now-scanner.at>5000 || scanner.at-now>1000 || typeof message.signature!=='string' || !/^[a-f0-9]{64}$/.test(message.signature))return this.#reject('INVALID_ENVELOPE');
    for(const [nonce,at] of this.#seen)if(now-at>60000)this.#seen.delete(nonce);
    if(this.#seen.has(scanner.nonce) || this.#seen.size>=10000)return this.#reject('REPLAY_OR_CAPACITY');
    const data={modality:message.modality,matched:message.matched,uuid:message.uuid??null};
    const expected=createHmac('sha256',this.#secret).update(JSON.stringify({topic:message.topic,data,scanner})).digest();
    if(!timingSafeEqual(expected,Buffer.from(message.signature,'hex')))return this.#reject('INVALID_SIGNATURE');
    this.#seen.set(scanner.nonce,now);this.#lastVerifiedAt=now;this.#verified++;return true;
  }
}
