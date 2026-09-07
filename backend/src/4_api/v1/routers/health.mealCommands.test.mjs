import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';
function setup() {
 const healthOperations={ defaultUsername:()=> 'u',nutritionItemsAvailable:true,nutritionInputAvailable:true,
  mealFoodCommand:vi.fn(async()=>({committed:true,entryIds:['a'],undoToken:'meal-token'})),
  undoMealFoodCommand:vi.fn(async()=>({committed:true,entryIds:['a']})),
  suggestMealGroups:vi.fn(async()=>({committed:false,groups:[]})),
  processNutritionInput:vi.fn(async()=>({committed:true})),
  runNutritionOperation:vi.fn(async(_u,_id,_payload,action)=>action()),
 };
 const app=express();app.use(createHealthRouter({healthOperations,logger:{info(){},warn(){},error(){},debug(){}}}));return {app,healthOperations};
}
describe('meal command HTTP adapter',()=>{
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
});
