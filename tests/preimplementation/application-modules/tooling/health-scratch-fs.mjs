/** Test-only Health fixtures: synthetic mtime, real bytes/mode; not native-copy parity. */
import fs from 'node:fs';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
export function installHealthScratchFsAdapter({scratchRoot,copyOnly=false,fixtureFamily='health',readOnlyFixtures=[]}) {
  const native={...fs};
  const root=path.resolve(scratchRoot);
  if(native.realpathSync(root)!==root || !native.lstatSync(root).isDirectory())throw new Error('Scratch root must be a real directory, without symlinks');
  if(!['health','remaining','retained'].includes(fixtureFamily))throw new Error('Unknown fixed fixture family');
  const readOnly=new Map(readOnlyFixtures.map(file=>{if(typeof file!=='string'||!path.isAbsolute(file)||native.realpathSync(file)!==file||!native.lstatSync(file).isFile())throw new Error('Read-only fixture must be canonical regular file');const stat=native.statSync(file);return [file,{dev:stat.dev,ino:stat.ino}];}));
  const timestamps=new Map();
  const controls={mtimeSets:0,overlayStats:0,byteCopies:0,modeVerifications:0};
  function checked(input,{missingLeaf=false,readOnlySource=false}={}) {
    if(typeof input!=='string')throw new TypeError('Fixture path must be a string');
    const file=path.resolve(input),relative=path.relative(root,file);
    if(readOnlySource&&readOnly.has(file)){const stat=native.lstatSync(file),initial=readOnly.get(file);if(native.realpathSync(file)!==file||!stat.isFile()||stat.dev!==initial.dev||stat.ino!==initial.ino)throw new Error('Read-only fixture identity changed');return file;}
    if(!relative || relative==='..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative))throw new Error('Fixture path escapes private scratch');
    const parts=relative.split(path.sep);let current=root;
    for(let i=0;i<parts.length;i++){
      current=path.join(current,parts[i]);let stat;
      try{stat=native.lstatSync(current);}catch(error){if(missingLeaf && i===parts.length-1 && error.code==='ENOENT')return file;throw error;}
      if(stat.isSymbolicLink())throw new Error('Fixture symlink forbidden');
      if(i<parts.length-1&&!stat.isDirectory())throw new Error('Fixture parent is not a directory');
      if(i===parts.length-1&&!stat.isFile())throw new Error('Fixture leaf must be a real regular file');
    }
    return file;
  }
  function utimesSync(input,atime,mtime) {
    const file=checked(input);
    const relative=path.relative(root,file).split(path.sep).join('/');
    const approved=fixtureFamily==='health'?/^scan-repair-[^/]+\/nutrition\/food_catalog\.yml\.tmp-1-abc$/.test(relative):[
      /^livestream-tts-test-\d+\/[a-f0-9]+\.mp3$/,
      /^wr-sweep-[A-Za-z0-9]+\/media\/weekly-review\/\d{4}-\d{2}-\d{2}\/\.drafts\/[A-Za-z0-9_.-]+\.processing-\d+\.webm$/,
      /^state-gates-realfs-[A-Za-z0-9]+\/current\.yml$/,
      /^pianoaudio-lib-[A-Za-z0-9]+\/history\/piano\/[A-Za-z0-9_./-]+\.mid$/,
    ].some(pattern=>pattern.test(relative));
    if(!approved)throw new Error('Unapproved synthetic mtime fixture');
    const milliseconds=mtime instanceof Date?+mtime:Number(mtime)*1000;
    if(!Number.isFinite(milliseconds))throw new TypeError('Invalid fixture mtime');
    const stat=native.statSync(file);
    timestamps.set(file,{milliseconds,dev:stat.dev,ino:stat.ino});controls.mtimeSets++;
  }
  function statSync(input,options) {
    const file=typeof input==='string'?path.resolve(input):null;
    const overlay=file&&timestamps.get(file);
    if(!overlay)return native.statSync(input,options);
    checked(input);
    const stat=native.statSync(input,options);
    if(String(stat.dev)!==String(overlay.dev)||String(stat.ino)!==String(overlay.ino))throw new Error('Synthetic mtime file identity changed');
    const result=Object.assign(Object.create(Object.getPrototypeOf(stat)),stat);
    result.mtime=new Date(overlay.milliseconds);
    result.mtimeMs=options?.bigint?BigInt(Math.trunc(overlay.milliseconds)):overlay.milliseconds;
    if(options?.bigint)result.mtimeNs=BigInt(Math.trunc(overlay.milliseconds*1e6));
    controls.overlayStats++;
    return result;
  }
  function copyFileSync(source,destination,flags=0) {
    if(flags!==0&&flags!==native.constants.COPYFILE_EXCL)throw new Error('Only ordinary or exclusive fixture byte copies supported');
    const src=checked(source,{readOnlySource:fixtureFamily!=='health'}),dest=checked(destination,{missingLeaf:true});
    if(fixtureFamily==='remaining'){
      const group=path.relative(root,dest).split(path.sep)[0];
      if(!/^(chess-backfill|school-lifecycle-e2e)-[A-Za-z0-9]+$/.test(group))throw new Error('Unapproved fixture copy destination');
      if(readOnly.has(src)){if(!group.startsWith('school-lifecycle-e2e-'))throw new Error('Read-only fixture copy requires School scratch');}
      else if(path.relative(root,src).split(path.sep)[0]!==group)throw new Error('Cross-fixture copy forbidden');
    }
    if(fixtureFamily==='retained'){
      const group=path.relative(root,dest).split(path.sep)[0];
      if(!/^(charades-history-cli|exercise-library-clean|producer-v2)-[A-Za-z0-9]+$/.test(group))throw new Error('Unapproved retained fixture copy destination');
      if(readOnly.has(src)){if(!group.startsWith('exercise-library-clean-'))throw new Error('Read-only fixture copy requires exercise corpus');}
      else if(path.relative(root,src).split(path.sep)[0]!==group)throw new Error('Cross-fixture copy forbidden');
    }
    if(src===dest)throw new Error('Fixture source and destination must differ');
    const sourceMode=native.statSync(src).mode&0o7777;
    const existing=native.existsSync(dest);
    if(existing&&flags===native.constants.COPYFILE_EXCL){const error=new Error('Fixture destination already exists');error.code='EEXIST';throw error;}
    if(existing&&(native.statSync(dest).mode&0o7777)!==sourceMode)throw new Error('Cannot preserve destination mode without forbidden metadata changes');
    let input,output;
    try{
      input=native.openSync(src,native.constants.O_RDONLY|native.constants.O_NOFOLLOW);
      const bytes=native.readFileSync(input);
      output=native.openSync(dest,native.constants.O_WRONLY|native.constants.O_CREAT|native.constants.O_NOFOLLOW|(flags===native.constants.COPYFILE_EXCL?native.constants.O_EXCL:native.constants.O_TRUNC),sourceMode);
      native.writeFileSync(output,bytes);
      if((native.fstatSync(output).mode&0o7777)!==sourceMode)throw new Error('Fixture copy mode not preserved; metadata repair forbidden');
      if(!native.readFileSync(dest).equals(bytes))throw new Error('Fixture byte copy verification failed');
      controls.modeVerifications++;controls.byteCopies++;
    }finally{if(output!==undefined)native.closeSync(output);if(input!==undefined)native.closeSync(input);}
  }
  if(copyOnly)return {copyFileSync,controls};
  fs.utimesSync=utimesSync;fs.statSync=statSync;fs.copyFileSync=copyFileSync;syncBuiltinESMExports();
  return {controls,restore(){fs.utimesSync=native.utimesSync;fs.statSync=native.statSync;fs.copyFileSync=native.copyFileSync;syncBuiltinESMExports();}};
}
