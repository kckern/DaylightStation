import { GRATITUDE_PROGRAM_ID,GRATITUDE_UNIT_ID,deriveGratitudeState } from '../domain/gratitude.mjs';
import { studyDayForInstant } from '../domain/studyDay.mjs';

export class GratitudeProgramLauncher {
  #store;#assignments;#grants;#clock;#timezone;#donow;#logger;
  constructor({store,assignments,grants=null,clock=()=>new Date(),timezone=null,donow=null,logger={}}){this.#store=store;this.#assignments=assignments;this.#grants=grants;this.#clock=clock;this.#timezone=timezone;this.#donow=donow;this.#logger=logger;}
  get id(){return GRATITUDE_PROGRAM_ID;} get surface(){return 'portal';} get locationHint(){return 'on the school screen';} get entryAction(){return null;} get replayable(){return true;} get saturdayCatchUp(){return false;}
  studyDay(){return studyDayForInstant(this.#clock().getTime(),{timezone:this.#timezone});}
  async #enrollment(id){return (await this.#assignments.get(id))?.programs?.find(p=>p.programId===this.id)??null;}
  async #records(id){
    return Promise.all((await this.#store.listDays(id)).map(async day=>{const read=await this.#store.read(id,day);if(!['ok','missing'].includes(read.status))throw new Error('Gratitude records unavailable');return {day,state:deriveGratitudeState(read.events,{now:this.#clock().toISOString()})};}));
  }
  async status({userId,day=null}){
    try{
      const enrollment=await this.#enrollment(userId);
      if(!enrollment)return {error:false,enrolled:false,doneToday:false,progressLabel:'No Gratitude assignment',terminal:false,score:null,obligationProgress:null,servedWork:[]};
      const records=await this.#records(userId);const current=records.find(r=>r.day===(day??this.studyDay()));
      const state=current?.state??deriveGratitudeState([]);const done=state.phase==='completed';
      const cooldown=records.some(r=>r.state.phase==='cooldown');
      return {error:false,enrolled:true,doneToday:done,terminal:false,score:null,subject:enrollment.subject??'scripture',schedule:enrollment.schedule??null,
        progressLabel:done?'Done':cooldown?'Try again after a break':['pending','assessing'].includes(state.phase)?'Answer saved — waiting':'Not started',
        obligationProgress:{completed:done?1:0,total:1},servedWork:done?[{unitId:GRATITUDE_UNIT_ID,title:enrollment.title??'Gratitude'}]:[]};
    }catch(error){this.#logger.warn?.('school.gratitude.status-unavailable',{userId,error:error.message});return {error:true,enrolled:null,doneToday:false,terminal:false,score:null,progressLabel:'Gratitude unavailable',obligationProgress:null,servedWork:[]};}
  }
  async issueLaunchTarget({userId}){
    if(!await this.#enrollment(userId))throw new Error('No Gratitude assignment');
    if(!this.#grants)throw new Error('Gratitude launch unavailable');
    const today=this.studyDay();const records=await this.#records(userId);
    const pendingDays=records.filter(r=>['assessing','pending'].includes(r.state.phase)&&r.state.submitted).map(r=>r.day);
    return {kind:'program',program:this.id,learnerId:userId,today,gratitudeGrant:this.#grants.issue({learnerId:userId,days:[...new Set([today,...pendingDays])]})};
  }
  async launch({userId}){
    if(!this.#donow)return {decision:'failed',message:'The school screen is unavailable.'};
    try{return await this.#donow.dispatch({surface:'portal',action:{target:await this.issueLaunchTarget({userId})},learnerId:userId,requestedBy:'school-program',ref:GRATITUDE_UNIT_ID,programId:this.id,force:'never_ask'});}
    catch(error){this.#logger.warn?.('school.gratitude.launch-failed',{userId,error:error.message});return {decision:'failed',message:'Gratitude could not open. Please try again.'};}
  }
}
