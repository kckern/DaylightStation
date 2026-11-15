/** Only the credential-authenticated device service can record its local package restriction. */
export class NativeLeaseConsumer {
  #clock;#last=null;deviceId;packageName;capability;capabilities;
  constructor({deviceId,packageName,clock}){this.deviceId=deviceId;this.packageName=packageName;this.capability=`native-lease:${packageName}`;this.capabilities=[this.capability];this.#clock=clock;}
  acknowledge(ack){if(ack?.protocol!==1 || ack.capabilityReady!==true || typeof ack.blocked!=='boolean' || !Number.isSafeInteger(ack.commandRevision) || !Number.isSafeInteger(ack.epoch))return false;this.#last={...ack,at:this.#clock.now()};return true;}
  #result(command,blocked){const value=this.#last;return value && this.#clock.now()-value.at<=5000 && value.epoch===command.epoch && value.commandRevision===command.commandRevision && value.blocked===blocked?{blocked,detail:{localLease:true,protocol:1}}:{ok:false,skipped:true};}
  stop=async command=>this.#result(command,true);
  release=async command=>this.#result(command,false);
}
