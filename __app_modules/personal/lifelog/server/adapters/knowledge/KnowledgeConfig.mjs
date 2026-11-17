import moment from 'moment-timezone';
export const KNOWLEDGE_DEFAULTS=Object.freeze({enabled:false,write:false,writer_env:null,writer_host:null,timezone:null,max_runs_per_day:4,post_entry_minutes:15,min_entry_chars:200,echo_enabled:true,echo_min_chars:600,sweep_at:'03:30',quiz_max:5,quiz_expiry_days:7,ab_days:14});
/** Invalid or unauthorized KB configuration never prevents the ordinary app booting. */
export function resolveKnowledgeConfig({configuration={},environment,hostId,platform=process.platform}={}){
 const raw=configuration?.knowledge??configuration,config={...KNOWLEDGE_DEFAULTS,...raw};
 const disabled=reason=>({active:false,reason,config});
 if(config.enabled!==true)return disabled('disabled');
 const integer=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
 if(typeof config.write!=='boolean'||typeof config.echo_enabled!=='boolean'||!integer(config.max_runs_per_day,1,4)||!integer(config.post_entry_minutes,1,60)||!integer(config.min_entry_chars,1,20000)||!integer(config.echo_min_chars,config.min_entry_chars,20000)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(config.sweep_at)||config.quiz_max!==5||config.quiz_expiry_days!==7||config.ab_days!==14||(config.timezone!==null&&(typeof config.timezone!=='string'||!moment.tz.zone(config.timezone))))return disabled('invalid_configuration');
 if(!config.write)return disabled('read_only');
 if(typeof config.writer_env!=='string'||!config.writer_env||typeof config.writer_host!=='string'||!config.writer_host||config.writer_env!==environment||config.writer_host!==hostId||platform!=='linux')return disabled('writer_role_mismatch');
 return {active:true,reason:null,config};
}
