import {createHash,timingSafeEqual} from 'node:crypto';
import {AccessDenied} from '../../shared/contracts.mjs';
const digest=value=>createHash('sha256').update(value).digest();
/** Transport proves an integration, not which human held a shared phone. */
export class ApprovalCallbackAuthority {
  #credential;#recipient;#principal;#lookup;
  constructor({credential,recipientId,principalId='home-assistant-supervision',lookupAction}){
    if(typeof credential!=='string' || credential.length<32 || !recipientId || !principalId || typeof lookupAction!=='function')throw new TypeError('Callback credential, recipient and lookup required');
    this.#credential=digest(credential);this.#recipient=recipientId;this.#principal=principalId;this.#lookup=lookupAction;
  }
  async authenticate({credentials,actionToken}){
    if(typeof credentials!=='string' || !timingSafeEqual(this.#credential,digest(credentials)))throw new AccessDenied('SUPERVISION_CALLBACK_UNAUTHENTICATED');
    const parsed=typeof actionToken==='string'?/^DS_SUPERVISION_(APPROVE|DENY):([A-Za-z0-9_-]{43})$/.exec(actionToken):null;
    if(!parsed)throw new AccessDenied('SUPERVISION_CALLBACK_INVALID');
    const decision=parsed[1].toLowerCase(),nonce=parsed[2],record=await this.#lookup({nonce,decision,recipientId:this.#recipient});
    if(!record)throw new AccessDenied('SUPERVISION_CALLBACK_INVALID');
    return {requestId:record.requestId,decision,nonce,actor:{id:`integration:${this.#principal}`,roles:['guardian'],authenticatedBy:'integration-credential',recipientId:this.#recipient}};
  }
}
