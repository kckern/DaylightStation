/** Sanitized tracked artifact copy using the existing build-stage byte/mode pattern. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export function stageTi86Fixtures({root,scratch,toolRoot,tracked,selected}){
 const stage=path.join(scratch,'artifact-source'),files=new Set();
 const excluded=file=>/(^|\/)(?:\.env[^/]*|node_modules|dist|build|\.git|vendor)(?:\/|$)/.test(file);
 for(const file of tracked)if(/^(?:_extensions\/(ti86-app|ticalc-relay)|modules\/school\/satellites\/(ti86-app|ticalc-relay))\//.test(file)&&!excluded(file)&&fs.existsSync(path.join(root,file))&&fs.lstatSync(path.join(root,file)).isFile())files.add(file);
 const imports=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).imports;
 const resolve=(file,specifier)=>{
  if(specifier.startsWith('.'))return path.relative(root,path.resolve(root,path.dirname(file),specifier));
  if(specifier.startsWith('#'))for(const [pattern,target]of Object.entries(imports)){
   if(typeof target!=='string')continue;const prefix=pattern.replace(/\*$/,'');if(specifier.startsWith(prefix))return target.replace(/^\.\//,'').replace('*',specifier.slice(prefix.length));
  }
  return null;
 };
 const queue=[...files];
 while(queue.length){const file=queue.pop();if(!/\.(mjs|js|cjs)$/.test(file))continue;
  const text=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+)['"]/g)){
   if(match[1].startsWith('.')&&!/\.(mjs|js|cjs|json)$/.test(match[1]))continue;const dependency=resolve(file,match[1]);if(!dependency)continue;
   if(dependency.startsWith('../')||path.isAbsolute(dependency)||excluded(dependency))throw new Error('Unsafe staged dependency '+dependency);
   if(!fs.existsSync(path.join(root,dependency)))throw new Error('Missing staged dependency '+file+' -> '+dependency);
   if(!fs.lstatSync(path.join(root,dependency)).isFile())throw new Error('Staged dependency must be regular '+dependency);
   if(!files.has(dependency)){files.add(dependency);queue.push(dependency);}
  }
 }
 for(const file of ['package.json','backend/package.json'])files.add(file);
 const inputs=[...files].sort().map(file=>{
  const source=path.join(root,file),destination=path.join(stage,file),bytes=fs.readFileSync(source),stat=fs.statSync(source);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes,{mode:stat.mode&0o777});
  if(!fs.readFileSync(destination).equals(bytes)||(fs.statSync(destination).mode&0o777)!==(stat.mode&0o777))throw new Error('Stage byte/mode mismatch '+file);
  return {file,sha256:createHash('sha256').update(bytes).digest('hex'),mode:stat.mode&0o777};
 });
 for(const scope of ['','backend'])fs.symlinkSync(path.join(toolRoot,scope,'node_modules'),path.join(stage,scope,'node_modules'),'dir');
 if(selected.some(file=>!files.has(file)))throw new Error('Selected artifact oracle not staged');
 return {stage,inputs,selectedFiles:selected.map(file=>path.join(stage,file))};
}
