import path from 'node:path';
import { createHash } from 'node:crypto';
import yaml from 'js-yaml';
export function knowledgeError(code) { const error = new Error(code); error.code = code; return error; }
export function assertUsername(username) { if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(username) || username === '..') throw knowledgeError('INVALID_KNOWLEDGE_USER'); }
export function stableJson(value) {
  return JSON.stringify(value, (_key,item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])) : item);
}
export const fileHash = value => createHash('sha256').update(stableJson(value)).digest('hex');
export const same = (a,b) => stableJson(a) === stableJson(b);
export function readYaml(io, file) {
  try { return yaml.load(io.readTextFromPath(file), {schema:yaml.JSON_SCHEMA}); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}
export function safeFile(root, relative) {
  if (typeof relative !== 'string' || !/^(?:state|roster)\.yml$|^(?:loops|people)\/[a-z0-9][a-z0-9-]{0,95}\.yml$|^closed\/\d{4}\/[a-z0-9][a-z0-9-]{0,95}\.yml$|^asks\/\d{4}-\d{2}-\d{2}\.yml$/.test(relative)) throw knowledgeError('INVALID_KNOWLEDGE_PATH');
  return path.join(root,relative);
}
export function objectPath(object) {
  const slug=object.id.split('.')[1];
  if(object.kind==='person')return 'people/'+slug+'.yml';
  if(['answered','stale','dropped'].includes(object.status))return 'closed/'+(object.closedOn??object.touched).slice(0,4)+'/'+slug+'.yml';
  return 'loops/'+slug+'.yml';
}
export function changedFields(before,after,prefix='') {
  if(same(before,after))return [];
  if(before && after && typeof before==='object' && typeof after==='object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>changedFields(before[key],after[key],prefix?prefix+'.'+key:key));
  }
  if(prefix==='evidence' && Array.isArray(before) && Array.isArray(after))return after.flatMap((item,i)=>changedFields(before[i],item,prefix+'.'+i));
  return [prefix];
}
export function readField(object,field) { return field.split('.').reduce((value,key)=>value?.[key],object); }
