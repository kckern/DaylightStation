const key=base=>`school:gratitude-launch:${base??'school'}`;
/** Per-tab resume only; server still validates the grant, day, and cooldown. */
export function readGratitudeLaunch(base){
  try{const value=JSON.parse(sessionStorage.getItem(key(base)));return value&&/^[a-z0-9][a-z0-9_-]*$/i.test(value.learnerId)&&typeof value.gratitudeGrant==='string'&&value.gratitudeGrant.length<4096&&/^\d{4}-\d{2}-\d{2}$/.test(value.today)?value:null;}catch{return null;}
}
export function saveGratitudeLaunch(base,value){try{if(value)sessionStorage.setItem(key(base),JSON.stringify(value));else sessionStorage.removeItem(key(base));}catch{/* unavailable session storage leaves normal launch usable */}}
