export const LOCAL_STOP_EVENT='daylight-parental-stop';
const KEY='daylight.parental-stop';
let volatileStop=null;
export function readLocalStop(){
  let raw;try{raw=localStorage.getItem(KEY);}catch{return volatileStop;}
  if(raw===null)return volatileStop;
  try{const value=JSON.parse(raw);return value && (value.epoch===null || Number.isSafeInteger(value.epoch))?value:{epoch:null};}catch{return {epoch:null};}
}
export function publishLocalStop({epoch=null}={}){
  const latch={epoch:Number.isSafeInteger(epoch)?epoch:null};
  volatileStop=latch;
  try{localStorage.setItem(KEY,JSON.stringify(latch));}catch{ /* Retain the current-page latch; durable server intent survives reload. */ }
  window.dispatchEvent(new CustomEvent(LOCAL_STOP_EVENT,{detail:latch}));
}
export function clearLocalStop(){volatileStop=null;try{localStorage.removeItem(KEY);}catch{ /* Canonical server checks remain mandatory. */ }}
