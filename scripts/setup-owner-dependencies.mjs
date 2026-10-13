#!/usr/bin/env node
/** Preserve native __backend/frontend dependency scopes for installed owners. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function setupOwnerDependencies(root,{check=false}={}) {
  root=path.resolve(root);
  const links=[];
  for(const area of ['__app_modules','__capabilities']) {
    const base=path.join(root,area);
    let baseType;try{baseType=fs.lstatSync(base);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!baseType.isDirectory())continue;
    const owners=fs.readdirSync(base,{withFileTypes:true}).filter(entry=>entry.isDirectory()).flatMap(entry=>{
      const directory=path.join(base,entry.name);
      const hasRuntime=['server','browser'].some(runtime=>{
        try{return fs.lstatSync(path.join(directory,runtime)).isDirectory();}catch(error){if(error.code==='ENOENT')return false;throw error;}
      });
      return area==='__app_modules'&&!hasRuntime
        ?fs.readdirSync(directory,{withFileTypes:true}).filter(child=>child.isDirectory()).map(child=>path.join(entry.name,child.name))
        :[entry.name];
    }).sort();
    for(const owner of owners) {
      for(const runtime of ['server','browser']) {
        const directory=path.join(base,owner,runtime);
        let type;try{type=fs.lstatSync(directory);}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(!type.isDirectory())continue;
        const target=path.relative(directory,path.join(root,runtime==='server'?'__backend':'frontend','node_modules'));
        const link=path.join(directory,'node_modules');
        let existing;try{existing=fs.lstatSync(link);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(existing&&(!existing.isSymbolicLink()||fs.readlinkSync(link)!==target))throw new Error('Refusing existing dependency directory/link: '+link);
        if(check) {
          if(!existing)throw new Error('Missing dependency link: '+link);
          let installed;try{installed=fs.statSync(path.resolve(directory,target)).isDirectory();}catch(error){if(error.code!=='ENOENT')throw error;}
          if(!installed)throw new Error('Missing dependency target: '+path.resolve(directory,target));
        }
        links.push({link,target,exists:Boolean(existing)});
      }
    }
  }
  if(!check)for(const {link,target,exists} of links)if(!exists)fs.symlinkSync(target,link,'dir');
  return links;
}
export {setupOwnerDependencies as setup};
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.slice(2).some(arg=>arg!=='--check')||process.argv.length>3)throw new Error('Only --check is supported');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const links=setupOwnerDependencies(root,{check:process.argv[2]==='--check'});
  console.log(`Owner dependency scopes ${process.argv[2]==='--check'?'ready':'linked'}: ${links.length}`);
}
