/** Activation is explicit: a matching device name alone proves no capability. */
export function validateConsumerManifest({devices,consumers}){
  if(!Array.isArray(devices) || !Array.isArray(consumers))throw new TypeError('Device and consumer manifests required');
  const missing=[];
  for(const device of devices){
    if(typeof device.id!=='string' || !Array.isArray(device.requiredCapabilities) || !device.requiredCapabilities.length)throw new TypeError('Required device capabilities must be explicit');
    const available=new Set(consumers.filter(consumer=>consumer.deviceId===device.id).flatMap(consumer=>consumer.capabilities??[]));
    for(const capability of device.requiredCapabilities)if(!available.has(capability))missing.push({deviceId:device.id,capability});
  }
  return {activationAllowed:devices.length>0 && missing.length===0,missing};
}
