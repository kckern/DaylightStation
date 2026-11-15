import {useEffect,useRef} from 'react';
import getLogger from '@/lib/logging/Logger.js';
const consumers=new Set();
export function registerActivityStop(stop){consumers.add(stop);return ()=>consumers.delete(stop);}
export function useActivityStop(stop){const current=useRef(stop);current.current=stop;useEffect(()=>registerActivityStop(context=>current.current(context)),[]);}
export function suspendActivities(context){
  for(const stop of [...consumers])try{const result=stop(context);result?.catch?.(error=>getLogger().warn('supervision.consumer.stop-failed',{error:error.message}));}catch(error){getLogger().warn('supervision.consumer.stop-failed',{error:error.message});}
  for(const media of document.querySelectorAll('audio,video'))try{media.pause();}catch{ /* Continue silencing other consumers. */ }
}
