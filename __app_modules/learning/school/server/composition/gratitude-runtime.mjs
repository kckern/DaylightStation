import path from 'node:path';
import { FilesystemProgramAudio } from '../adapters/audio/FilesystemProgramAudio.mjs';
import { GratitudeService } from '../application/gratitude/GratitudeService.mjs';
import { GratitudeJudge } from '../application/gratitude/GratitudeJudge.mjs';
import { GratitudeTopicExtractor } from '../application/gratitude/GratitudeTopicExtractor.mjs';
import { GratitudeFollowUpWriter } from '../application/gratitude/GratitudeFollowUpWriter.mjs';
import { captureProgramTake } from '../application/shared/captureProgramTake.mjs';
import { gratitudeConfigOf, GRATITUDE_TRANSCRIPTION_HINT } from '../domain/gratitude.mjs';
import { createSchoolGratitudeRouter } from '../api/schoolGratitude.mjs';

export function createGratitudeRuntime({configService,store,assignments,grants,teacherGate,aiGateway,decisionGateway,publish,notify=null,scheduler,timezone,householdSchedule,clock=()=>new Date(),logger={}}){
  const config=gratitudeConfigOf(configService.getHouseholdAppConfig(null,'school')??{});
  const audio=new FilesystemProgramAudio({rootDir:path.join(configService.getMediaDir(),'school/gratitude'),clock:()=>clock().getTime()});
  const bounded=(work,message)=>scheduler.withDeadline(work,{milliseconds:30_000,errorFactory:()=>new Error(message)});
  const service=new GratitudeService({store,assignments,grants,timezone,householdSchedule,clock,logger,config,
    judge:new GratitudeJudge({decisionGateway,scheduler,logger,config:config.judge}),extractor:new GratitudeTopicExtractor({aiGateway,scheduler,logger,config:config.extractor}),
    followUpWriter:new GratitudeFollowUpWriter({aiGateway,scheduler,logger,config:config.followUp}),
    captureTake:args=>{
      if(args.savedAudioRef){
        const saved=audio.read(args.learnerId,args.savedAudioRef.split('/')[1]);
        if(!saved)throw new Error('The saved recording could not be read');
        args={...args,buffer:saved.buffer,mimeType:saved.mimeType};
      }
      // `transcribed` tells an empty transcript (nothing heard) from a transcriber failure (retry the saved audio).
      let transcribed=false;
      const transcribe=aiGateway?.transcribe?((buffer,opts)=>bounded(aiGateway.transcribe(buffer,opts),'Transcription timed out').then(text=>{transcribed=true;return text;})):null;
      return captureProgramTake({...args,saveAudio:body=>audio.save(body),transcribe,prompt:GRATITUDE_TRANSCRIPTION_HINT,logger}).then(result=>({...result,transcribed}));
    },
    publish:async body=>{const result=await bounded(Promise.resolve().then(()=>publish(body)),'Saving gratitude timed out');try{await notify?.({...body,...result});}catch(error){logger.warn?.('school.gratitude.notify-failed',{error:error.message});}return result;},
  });
  return {service,router:createSchoolGratitudeRouter({service,grants,teacherGate,audioStore:audio,logger})};
}
