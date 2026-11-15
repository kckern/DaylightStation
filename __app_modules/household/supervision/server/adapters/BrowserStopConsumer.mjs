/** A recent framework heartbeat is required; Stop ACK follows the unmount commit. */
export class BrowserStopConsumer {
  #clock;#last=null;deviceId;capability='browser';capabilities=['browser'];
  constructor({deviceId,clock}){this.deviceId=deviceId;this.#clock=clock;}
  acknowledge(input){if(input?.protocol!==2 || typeof input.blocked!=='boolean' || !Number.isSafeInteger(input.commandRevision))throw new TypeError('Browser enforcement protocol 2 required');this.#last={...input,at:this.#clock.now()};}
  stop=async({commandRevision})=>{return {blocked:this.#recent() && this.#last.blocked && this.#last.commandRevision===commandRevision};}
  release=async()=>{return this.#recent()?{blocked:false}:{ok:false,skipped:true};}
  #recent(){return this.#last && this.#clock.now()-this.#last.at<=5000;}
}
