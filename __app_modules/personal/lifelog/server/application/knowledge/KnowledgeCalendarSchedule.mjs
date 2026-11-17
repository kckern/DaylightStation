import moment from 'moment-timezone';
/** Calendar arithmetic in the user's timezone; never an elapsed24hour recurrence. */
export function nextKnowledgeRun({asOf,timezone,at,weekday}){
 if(!Number.isFinite(asOf)||!moment.tz.zone(timezone)||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(at))throw new TypeError('Invalid knowledge schedule');
 const [hour,minute]=at.split(':').map(Number),current=moment.tz(asOf,timezone);
 const next=current.clone().startOf('day').hour(hour).minute(minute);
 if(weekday!=null){if(!Number.isInteger(weekday)||weekday<1||weekday>7)throw new TypeError('Invalid weekday');next.isoWeekday(weekday);}
 if(next.valueOf()<=asOf)next.add(weekday==null?1:7,'days');
 return next.valueOf();
}
