/** Invoke the unchanged original pre-commit against the actual working tree/index. */
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=fs.realpathSync(new URL('../../../../',import.meta.url));
if(process.argv.length!==2||process.platform!=='linux'||process.arch!=='x64')throw Error('Fixed original hook only');
const toolRoot=fs.realpathSync(process.env.PRE_TOOLCHAIN_ROOT);
const git=args=>{const p=spawnSync('/usr/bin/git',args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});if(p.status!==0)throw Error(p.stderr);return p.stdout.trim();};
const metadata=git(['rev-parse','--absolute-git-dir']),common=fs.realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir'])));
const run=fs.mkdtempSync(path.join(root,'.superpowers/sdd/2026-10-08-gratitude-module-proof/landlock-runs/hook-')),scratch=path.join(run,'scratch'),denied=path.join(run,'denied');for(const d of [scratch,denied])fs.mkdirSync(d);
fs.writeFileSync(path.join(denied,'private.env'),'synthetic private sentinel\n');fs.symlinkSync(path.join(denied,'private.env'),path.join(scratch,'escape'));
for(const file of ['openssl.cnf','npmrc','.gitconfig'])fs.writeFileSync(path.join(scratch,file),'');
// Restore ordinary package resolution locally without installing or changing versions.
for(const name of fs.readdirSync(path.join(toolRoot,'node_modules')))if(!name.startsWith('.')||name==='.bin'){const dest=path.join(root,'node_modules',name);if(!fs.existsSync(dest))fs.symlinkSync(path.join(toolRoot,'node_modules',name),dest);}
for(const name of ['.vite','.vite-temp']){const dest=path.join(root,'node_modules',name),target=path.join(scratch,name);fs.mkdirSync(target);if(fs.existsSync(dest)||fs.lstatSync(path.dirname(dest)).isDirectory()){try{if(fs.lstatSync(dest).isSymbolicLink())fs.unlinkSync(dest);else fs.renameSync(dest,path.join(run,'prior-'+name));}catch(e){if(e.code!=='ENOENT')throw e;}}fs.symlinkSync(target,dest);}
const grants=new Map(),sources=[];const add=(p,t)=>grants.set(fs.realpathSync(p),t);
const tracked=(git(['ls-files','-z'])+'\0'+git(['ls-files','--others','--exclude-standard','-z'])).split('\0').filter(Boolean);
const privatePath=/(^|\/)(\.env(?:\.[^/]*)?|private\.env|\.npmrc)(\/|$)/;
for(const name of tracked){const file=path.join(root,name);if(privatePath.test(name)||!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())continue;if(/\.(mjs|js|jsx|tsx|ts|cjs|json|scss|css|svg|glsl|ttf|yaml|yml)$/.test(name)||name==='package.json'||/(^|\/)(\.gitignore|\.gitattributes)$/.test(name)||name.startsWith('.githooks/'))sources.push(file);}
// git's tracked/untracked inventory above includes owner source and skips ignored dependency links.

for(const name of fs.readdirSync(path.join(root,'scripts')))if(/\.(mjs|json)$/.test(name))sources.push(path.join(root,'scripts',name));
sources.push(path.join(root,'tests/_infrastructure/frontend-env.mjs'),path.join(root,'.githooks/pre-commit'));
for(const file of sources){add(file,'F');for(let dir=path.dirname(file);dir.startsWith(root);dir=path.dirname(dir))add(dir,'L');}
for(const file of [path.join(root,'.git'),...['HEAD','index','commondir','gitdir'].map(f=>path.join(metadata,f))])if(fs.existsSync(file))add(file,'F');
for(const folder of ['objects','refs'])add(path.join(common,folder),'D');
add(path.join(common,'config'),'F');
if(fs.existsSync(path.join(common,'info/exclude')))add(path.join(common,'info/exclude'),'F');
for(const file of ['packed-refs','HEAD'])if(fs.existsSync(path.join(common,file)))add(path.join(common,file),'F');
for(const scope of ['','backend','frontend'])add(path.join(toolRoot,scope,'node_modules'),'D');
for(const bin of ['/bin/sh','/usr/bin/git','/usr/bin/env',path.join(toolRoot,'node_modules/vitest/vitest.mjs'),path.join(toolRoot,'node_modules/@esbuild/linux-x64/bin/esbuild'),path.join(toolRoot,'frontend/node_modules/@esbuild/linux-x64/bin/esbuild')])add(bin,'X');
const npm=fs.realpathSync(path.join(path.dirname(process.execPath),'npm'));add(path.dirname(path.dirname(npm)),'D');add(npm,'X');
for(const lib of ['libz.so.1','libpcre2-8.so.0','librt.so.1','libuuid.so.1','libresolv.so.2'])add('/lib/x86_64-linux-gnu/'+lib,'F');
// check:scss uses the installed JS Sass implementation, with confined esbuild children.
const sass=path.join(toolRoot,'node_modules/sass-embedded-linux-x64/dart-sass/src/dart');if(fs.existsSync(sass))add(sass,'X');
const manifest=path.join(run,'read-allowlist.tsv');fs.writeFileSync(manifest,[...grants].map(([p,t])=>`${t}\t${p}\n`).join(''));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs=[...new Set([...sources,...[...grants].filter(([,t])=>t==='F').map(([file])=>file)])].map(file=>({file,sha256:hash(file)}));
const c=path.join(root,'tests/preimplementation/application-modules/tooling/landlock-runner.c'),binary=path.join(run,'launcher');const launcherSha256=hash(c);
const compile=spawnSync('/usr/bin/gcc',['-O2','-Wall','-Wextra','-Werror',c,'-o',binary],{encoding:'utf8'});if(compile.status!==0)throw Error(compile.stderr);
const args=[scratch,fs.realpathSync(process.execPath),manifest,toolRoot,'unused',path.join(root,'.githooks/pre-commit'),denied,'hook','baseline',''];
const result=spawnSync('/usr/bin/timeout',['--signal=KILL','1810s',binary,...args],{cwd:root,encoding:'utf8',timeout:1815000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin'}});
const output=fs.readFileSync(path.join(scratch,'result.txt'),'utf8'),protectedInputsUnchanged=inputs.every(i=>hash(i.file)===i.sha256);
const controls=output.includes('socket(AF_INET): EPERM\n')&&output.includes('HOOK FILESYSTEM CONTROLS PASS\n')&&fs.readFileSync(path.join(denied,'private.env'),'utf8')==='synthetic private sentinel\n';
const receipt={controls,head:git(['rev-parse','HEAD']),pack:'original-pre-commit',capturedAt:new Date().toISOString(),exitCode:result.status,signal:result.signal,protectedInputsUnchanged,launcherSha256,inputs,gitReadOnly:{metadata,objects:path.join(common,'objects'),refs:path.join(common,'refs'),configGranted:true},command:{executable:'/usr/bin/timeout',args:['--signal=KILL','1810s',binary,...args]},output};fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({receipt:path.relative(root,path.join(run,'receipt.json')),exitCode:result.status,controls,protectedInputsUnchanged}));if(result.status!==0||!controls||!protectedInputsUnchanged){console.log(output.slice(-7000)+result.stderr);process.exitCode=1;}
