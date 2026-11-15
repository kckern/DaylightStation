/** Transport metadata only; the server independently authenticates and checks scope. */
const contexts=new Map();
export function setRequestContextHeaders(namespace,headers){
  if(!headers){contexts.delete(namespace);return;}
  contexts.set(namespace,Object.fromEntries(Object.entries(headers).filter(([name,value])=>/^x-/i.test(name) && name.toLowerCase()!=='x-daylight-device' && typeof value==='string' && value.length>0)));
}
export function readRequestContextHeaders(){return Object.assign({},...contexts.values());}
