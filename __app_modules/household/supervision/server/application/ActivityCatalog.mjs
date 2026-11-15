import {AccessDenied} from '../../shared/contracts.mjs';
/** Explicit public labels and routes; protected application views never supply shell metadata. */
export class ActivityCatalog {
  #activities;#learners;
  constructor({activities=[],devices,getLearners=()=>[]}){
    const ids=new Set(),paths=new Set(),known=new Set(devices.map(device=>device.id));
    for(const activity of activities){
      if(!activity.id || !activity.label || !/^\/(?!\/)[^?#]*$/.test(activity.path??'') || paths.has(activity.path) || ids.has(activity.id) || !['school','piano-game','arcade','fitness-module','media-single'].includes(activity.owner) || !activity.devices?.length || activity.devices.some(id=>!known.has(id)) || (activity.subtree && activity.owner!=='school'))throw new TypeError('Explicit unique supervised activity catalog required');
      ids.add(activity.id);paths.add(activity.path);
    }
    this.#activities=structuredClone(activities);this.#learners=getLearners;
  }
  async list({deviceId,path}){
    const activities=this.#activities.filter(activity=>activity.devices.includes(deviceId)),learners=await this.#learners();
    const current=activities.find(activity=>activity.path===path || (activity.subtree && path?.startsWith(activity.path+'/')));
    return {activities:activities.map(({id,label,path})=>({id,label,path})),learners:learners.map(({id,label})=>({id,label})),currentActivityId:current?.id??'kiosk:unlisted'};
  }
  async resolve(context){
    const activity=this.#activities.find(activity=>activity.id===context.activityId && activity.devices.includes(context.deviceId));
    if(!activity || !(await this.#learners()).some(learner=>learner.id===context.learnerId))throw new AccessDenied('SUPERVISION_ACTIVITY_UNKNOWN');
    return {...structuredClone(activity),deviceId:context.deviceId};
  }
}
