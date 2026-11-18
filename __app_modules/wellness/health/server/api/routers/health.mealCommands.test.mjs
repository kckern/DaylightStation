import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from "./health.mjs";
function setup() {
 const healthOperations={ defaultUsername:()=> 'u',nutritionItemsAvailable:true,nutritionInputAvailable:true,
  mealFoodCommand:vi.fn(async()=>({committed:true,entryIds:['a'],undoToken:'meal-token'})),
  undoMealFoodCommand:vi.fn(async()=>({committed:true,entryIds:['a']})),
  moveFoods:vi.fn(async()=>({committed:true,undoToken:'meal-token',movedCount:1})),
  suggestMealGroups:vi.fn(async()=>({committed:false,groups:[]})),
  processNutritionInput:vi.fn(async()=>({committed:true})),
  processDayInput:vi.fn(async()=>({committed:true,outcome:'committed',kind:'moved'})),
  runNutritionOperation:vi.fn(async(_u,_id,_payload,action)=>action()),
  clearFailedNutritionOperation:vi.fn(()=>true),
 };
 const app=express();app.use(createHealthRouter({healthOperations,logger:{info(){},warn(){},error(){},debug(){}}}));return {app,healthOperations};
}
describe('meal command HTTP adapter',()=>{
 it('routes food moves through the server user',async()=>{
  const {app,healthOperations:ops}=setup();const body={date:'2026-09-06',selectedIds:['a'],expectedVersions:{a:1},toDate:'2026-09-05',operationId:'move'};
  const response=await request(app).post('/nutrition/foods-move').send(body);
  expect(response.status).toBe(200);expect(response.body.undoToken).toBe('meal-token');expect(ops.moveFoods).toHaveBeenCalledWith('u',body);
 });
 it('uses the server user and returns committed command and Undo responses',async()=>{
  const {app,healthOperations:ops}=setup(); const body={date:'2026-09-06',bucket:'evening',action:'group',selectedIds:['a','b'],operationId:'op',expectedVersions:{a:1,b:1},name:'Soup'};
  const response=await request(app).post('/nutrition/meal-command').send(body);expect(response.status).toBe(200);expect(response.body.undoToken).toBe('meal-token');expect(ops.mealFoodCommand).toHaveBeenCalledWith('u',body);
  const undo=await request(app).post('/nutrition/meal-undo').send({undoToken:'meal-token',operationId:'undo'});expect(undo.status).toBe(200);expect(ops.undoMealFoodCommand).toHaveBeenCalledWith('u',{undoToken:'meal-token',operationId:'undo'});
 });
 it('returns version conflicts as 409 and validates suggestion scope before invoking AI',async()=>{
  const {app,healthOperations:ops}=setup();ops.mealFoodCommand.mockRejectedValue(Object.assign(new Error('Reload'),{status:409,code:'VERSION_CONFLICT'}));
  expect((await request(app).post('/nutrition/meal-command').send({})).status).toBe(409);
  expect((await request(app).post('/nutrition/meal-suggestions').send({date:'2026-09-06',bucket:'wrong',selectedIds:[]})).status).toBe(400);expect(ops.suggestMealGroups).not.toHaveBeenCalled();
  expect((await request(app).post('/nutrition/meal-suggestions').send({date:'2026-09-06',bucket:'evening',selectedIds:['a']})).body).toEqual({committed:false,groups:[]});
 });
 it('includes selection and clarification in capture fingerprint and rejects malformed IDs',async()=>{
  const {app,healthOperations:ops}=setup();const input={type:'voice',content:'audio',date:'2026-09-06',bucket:'evening',selectedIds:['a'],clarification:'a',operationId:'capture'};
  expect((await request(app).post('/nutrition/input').send(input)).status).toBe(200);expect(ops.runNutritionOperation.mock.calls[0][2]).toMatchObject({selectedIds:['a'],clarification:'a'});expect(ops.processNutritionInput).toHaveBeenCalledWith(expect.objectContaining({selectedIds:['a'],clarification:'a'}));
  expect((await request(app).post('/nutrition/input').send({...input,selectedIds:['../bad']})).status).toBe(400);
 });
 describe('day input',()=>{
  const body={type:'text',content:'move that',date:'2026-09-06',operationId:'day',resolved:{toDate:'2026-09-01'}};
  const post=(app,sent)=>request(app).post('/nutrition/day-input').send(sent);
  it('routes day input through an idempotent operation and validates it',async()=>{
   const {app,healthOperations:ops}=setup();
   const response=await post(app,body);
   expect(response.status).toBe(200);expect(response.body.kind).toBe('moved');
   expect(ops.runNutritionOperation.mock.calls[0][1]).toBe('day');
   expect(ops.runNutritionOperation.mock.calls[0][2]).toEqual({operation:'day-input',type:'text',content:'move that',date:'2026-09-06',resolved:{toDate:'2026-09-01'}});
   expect(ops.processDayInput).toHaveBeenCalledWith({userId:'u',type:'text',content:'move that',date:'2026-09-06',operationId:'day',resolved:{toDate:'2026-09-01'}});
   ops.processDayInput.mockClear();
   for(const bad of [{type:'image'},{date:'bad'},{content:'  '},{type:'voice',content:'not a recording'},{type:'voice',content:'data:audio/webm,AAAA'},{type:'voice',content:'data:audio/webm;base64,'},{type:'voice',content:'data:audio/webm;base64,A'},{type:'voice',content:'data:audio/webm;base64,$$$$'},{type:'voice',content:'data:audio/webm;base64'}]) expect((await post(app,{...body,...bad})).status).toBe(400);
   expect(ops.processDayInput).not.toHaveBeenCalled();
  });
  it('requires a valid operation ID',async()=>{
   const {app,healthOperations:ops}=setup();const {operationId:_omit,...withoutId}=body;
   expect((await post(app,withoutId)).status).toBe(400);
   expect((await post(app,{...body,operationId:'not valid!'})).status).toBe(400);
   expect((await post(app,{...body,operationId:7})).status).toBe(400);
   expect(ops.runNutritionOperation).not.toHaveBeenCalled();
  });
  it('does not take today from the client',async()=>{
   const {app,healthOperations:ops}=setup();
   await post(app,{...body,today:'2099-01-01'});
   expect(ops.processDayInput.mock.calls[0][0]).not.toHaveProperty('today');
   expect(ops.runNutritionOperation.mock.calls[0][2]).not.toHaveProperty('today');
  });
  it('accepts only string foodId and toDate as a clarification',async()=>{
   const {app,healthOperations:ops}=setup();
   for(const resolved of [null,[],'a',{toDate:7},{foodId:null},{foodId:''},{foodId:'a',extra:'b'}]) expect((await post(app,{...body,resolved})).status).toBe(400);
   expect(ops.processDayInput).not.toHaveBeenCalled();
   const {resolved:_omit,...plain}=body;
   expect((await post(app,plain)).status).toBe(200);expect(ops.processDayInput.mock.calls[0][0].resolved).toEqual({});
  });
  it('fingerprints a retry the same way whatever order its clarification keys arrive in',async()=>{
   const {app,healthOperations:ops}=setup();
   await post(app,{...body,resolved:{foodId:'a',toDate:'2026-09-01'}});await post(app,{...body,resolved:{toDate:'2026-09-01',foodId:'a'}});
   const [first,second]=ops.runNutritionOperation.mock.calls.map(call=>JSON.stringify(call[2]));
   expect(second).toBe(first);
  });
  it('keeps the transcription failure and its saved recording',async()=>{
   const {app,healthOperations:ops}=setup();ops.processDayInput.mockRejectedValue(Object.assign(new Error('Could not hear that correction'),{status:502,code:'TRANSCRIBE_FAILED',audioRef:'va_1'}));
   const response=await post(app,{...body,type:'voice',content:'data:audio/webm;base64,AAAA'});
   expect(response.status).toBe(502);expect(response.body).toEqual({error:'Could not hear that correction',code:'TRANSCRIBE_FAILED',audioRef:'va_1'});
  });
  it('passes on its own refusals',async()=>{
   const {app,healthOperations:ops}=setup();
   ops.processDayInput.mockRejectedValueOnce(Object.assign(new Error('This entry changed. Reload before saving.'),{status:409}));
   expect((await post(app,body)).status).toBe(409);
   ops.processDayInput.mockRejectedValueOnce(Object.assign(new Error('Day input is unavailable right now'),{status:503,code:'DAY_INPUT_UNAVAILABLE'}));
   expect((await post(app,body)).body.code).toBe('DAY_INPUT_UNAVAILABLE');
  });
  it('limits typed instructions to what a food log can hold',async()=>{
   const {app,healthOperations:ops}=setup();
   const tooLong=await post(app,{...body,content:'a'.repeat(2001)});
   expect(tooLong.status).toBe(400);expect(tooLong.body).toEqual({error:'That is too long to log at once. Try it in two parts.',code:'DAY_INPUT_TOO_LONG'});
   expect(ops.runNutritionOperation).not.toHaveBeenCalled();
   expect((await post(app,{...body,content:`  ${'a'.repeat(2000)}  `})).status).toBe(200);
  });
  it('passes on an over-long transcript with its recording',async()=>{
   const {app,healthOperations:ops}=setup();ops.processDayInput.mockRejectedValue(Object.assign(new Error('That is too long to log at once. Try it in two parts.'),{status:422,code:'DAY_INPUT_TOO_LONG',audioRef:'va_1'}));
   const response=await post(app,{...body,type:'voice',content:'data:audio/webm;base64,AAAA'});
   expect(response.status).toBe(422);expect(response.body).toMatchObject({code:'DAY_INPUT_TOO_LONG',audioRef:'va_1'});
  });
  it('takes a saved recording in place of content',async()=>{
   const {app,healthOperations:ops}=setup();const {content:_omit,...rest}=body;
   expect((await post(app,{...rest,type:'voice',audioRef:'va_saved'})).status).toBe(200);
   expect(ops.runNutritionOperation.mock.calls[0][2]).toEqual({operation:'day-input',type:'voice',audioRef:'va_saved',date:'2026-09-06',resolved:{toDate:'2026-09-01'}});
   expect(ops.processDayInput.mock.calls[0][0]).toMatchObject({type:'voice',audioRef:'va_saved'});
   expect(ops.processDayInput.mock.calls[0][0]).not.toHaveProperty('content');
   ops.processDayInput.mockClear();
   for(const bad of [{...rest,type:'voice',audioRef:'../secret'},{...rest,type:'voice',audioRef:7},{...rest,type:'text',audioRef:'va_saved'},{...body,type:'voice',content:'data:audio/webm;base64,AAAA',audioRef:'va_saved'}]) expect((await post(app,bad)).status).toBe(400);
   expect(ops.processDayInput).not.toHaveBeenCalled();
  });
  it('answers a missing recording as the capture route does',async()=>{
   const {app,healthOperations:ops}=setup();const {content:_omit,...rest}=body;const gone=()=>Object.assign(new Error('That recording is no longer available'),{code:'AUDIO_NOT_FOUND'});
   ops.processDayInput.mockRejectedValue(gone());ops.processNutritionInput.mockRejectedValue(gone());
   const response=await post(app,{...rest,type:'voice',audioRef:'va_gone'});
   const capture=await request(app).post('/nutrition/input').send({type:'voice',audioRef:'va_gone'});
   expect(response.status).toBe(404);expect(response.status).toBe(capture.status);expect(response.body).toEqual(capture.body);
  });
  it('frees the operation ID after a failure that kept a recording, so the retry can name it',async()=>{
   const {app,healthOperations:ops}=setup();ops.processDayInput.mockRejectedValue(Object.assign(new Error('Could not hear that correction'),{status:502,code:'TRANSCRIBE_FAILED',audioRef:'va_1'}));
   await post(app,{...body,type:'voice',content:'data:audio/webm;base64,AAAA'});
   expect(ops.clearFailedNutritionOperation).toHaveBeenCalledWith('u','day');
   ops.clearFailedNutritionOperation.mockImplementation(()=>{throw new Error('disk');});
   expect((await post(app,{...body,type:'voice',content:'data:audio/webm;base64,AAAA'})).status).toBe(502);
  });
  it('does not repeat an upstream provider status or message',async()=>{
   const {app,healthOperations:ops}=setup();
   for(const status of [401,429,500,502,503]){
    ops.processDayInput.mockRejectedValueOnce(Object.assign(new Error('Provider said no'),{status,code:'provider_code'}));
    const response=await post(app,body);
    expect(response.status).toBe(500);expect(JSON.stringify(response.body)).not.toContain('rovider');
   }
  });
 });
});
