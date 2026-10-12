import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const catalogs={'piano-exercises':'/api/v1/piano/bank/catalog','piano-programs':'/api/v1/piano/programs'};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=(object,expected)=>assert.deepEqual(Object.keys(object).sort(),expected.slice().sort());
const integer=n=>Number.isSafeInteger(n)&&n>=0;
export function validateOptions({origin,expectedCommit,catalogs:selected=[]}) {
  const url=new URL(origin);
  assert.ok(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/','Supply one origin without credentials/path/query');
  assert.match(expectedCommit,/^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(selected)&&new Set(selected).size===selected.length&&selected.every(id=>Object.hasOwn(catalogs,id)),'Unknown or duplicate catalog ID');
  return {origin:url.origin,expectedCommit,catalogs:selected};
}
export function assetPath(html) {
  const paths=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(x=>x[1]);
  const path=paths.find(x=>/^\/assets\/[A-Za-z0-9_-]+\.js$/.test(x));
  assert.ok(path,'Root HTML lacks a built same-origin JavaScript asset');
  return path;
}
export function validateObservation(id,o,commit) {
  assert.equal(o.status,200,`${id}: status`);
  assert.ok(Buffer.isBuffer(o.body)&&o.body.length>0&&o.body.length<=1048576,`${id}: body cap`);
  const type=o.headers['content-type']??'';
  if(o.headers['content-length']!==undefined) assert.equal(o.headers['content-length'],String(o.body.length),`${id}: content length`);
  const text=o.body.toString('utf8');
  if(id==='root') {assert.match(type,/^text\/html(?:;|$)/);assert.match(text,/<html\b/i);assetPath(text);return;}
  if(id==='asset') {assert.match(type,/^(?:text|application)\/javascript(?:;|$)/);return;}
  if(id==='built') {
    assert.match(type,/^text\/plain(?:;|$)/);
    assert.match(text,/^Build Time: [^\r\n]+\nCommit: https:\/\/github\.com\/kckern\/DaylightStation\/commit\/[a-f0-9]{40}\n?$/,'Expected baked marker, not working-tree fallback');
    assert.ok(!/^Build Time: (?:dev\b|unknown\b)/.test(text),'Unbuilt marker refused');
    const matches=[...text.matchAll(/https:\/\/github\.com\/kckern\/DaylightStation\/commit\/([a-f0-9]{40})(?![a-f0-9])/g)];
    assert.equal(matches.length,1,'Baked build marker must contain one complete commit URL');
    assert.equal(matches[0][1],commit,'Baked build commit differs');return;
  }
  assert.match(type,/^application\/json(?:;|$)/);
  const body=JSON.parse(text);
  if(id==='healthz'||id==='ping') {
    keys(body,id==='healthz'?['ok','server','timestamp','uptime']:['ok','timestamp']);
    assert.equal(body.ok,true);assert.ok(integer(body.timestamp));
    assert.ok(body.timestamp>=o.startedAt-10000&&body.timestamp<=o.endedAt+10000,'Server clock outside 10second skew budget');
    if(id==='healthz') {assert.equal(body.server,'main');assert.ok(Number.isFinite(body.uptime)&&body.uptime>=0);}
    return;
  }
  if(id==='piano-programs') {
    keys(body,['programs']);assert.ok(Array.isArray(body.programs));
    assert.ok(body.programs.every(p=>p&&typeof p.id==='string'&&p.id.length>0));
    assert.equal(new Set(body.programs.map(p=>p.id)).size,body.programs.length);return;
  }
  assert.equal(id,'piano-exercises');keys(body,['title','categories','seeds','totals']);
  assert.equal(typeof body.title,'string');assert.ok(Array.isArray(body.categories)&&Array.isArray(body.seeds));
  keys(body.totals,['seeds','variants']);assert.equal(body.totals.seeds,body.seeds.length);
  assert.ok(body.categories.every(c=>c&&typeof c.id==='string'));
  assert.ok(body.seeds.every(s=>s&&typeof s.id==='string'&&typeof s.title==='string'&&integer(s.variants)));
  assert.equal(new Set(body.seeds.map(s=>s.id)).size,body.seeds.length);
  assert.equal(body.totals.variants,body.seeds.reduce((n,s)=>n+s.variants,0));
}
export async function runSmoke(options,transport) {
  const config=validateOptions(options), observations=[];
  const requests=[['healthz','/healthz'],['ping','/api/v1/ping'],['built','/build.txt'],['root','/']];
  for(const id of config.catalogs) requests.push([id,catalogs[id]]);
  for(let i=0;i<requests.length;i++) {
    const [id,path]=requests[i],o=await transport(path,config.origin);
    validateObservation(id,o,config.expectedCommit);
    observations.push({id,path,status:o.status,headers:o.headers,bytes:o.body.length,bodySha256:hash(o.body),startedAt:o.startedAt,endedAt:o.endedAt});
    if(id==='root')requests.splice(i+1,0,['asset',assetPath(o.body.toString('utf8'))]);
  }
  return {schema:'daylight.production-readonly-smoke/v1',accepted:true,origin:config.origin,expectedCommit:config.expectedCommit,observations,method:'GET',authenticated:false,scope:'Finite health/build/frontend/local catalog smoke; no full suite or device/provider credit'};
}
async function fetchBounded(path,origin) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),5000),startedAt=Date.now();
  try {
    const response=await fetch(origin+path,{method:'GET',redirect:'manual',credentials:'omit',headers:{accept:'*/*','accept-encoding':'identity'},signal:controller.signal});
    assert.equal(response.status,200,'Redirect/error responses refused');
    assert.ok(!response.headers.get('content-encoding'),'Compressed body would invalidate raw-byte length checks');
    const chunks=[];let size=0;
    for await(const chunk of response.body) {size+=chunk.length;assert.ok(size<=1048576,'Body exceeds1MiB');chunks.push(chunk);}
    return {status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.concat(chunks),startedAt,endedAt:Date.now()};
  } finally {clearTimeout(timeout);}
}
export function parseOptions(args) {
  const values={};
  for(let i=0;i<args.length;i+=2) {assert.ok(['--origin','--expected-commit','--catalogs','--output'].includes(args[i])&&args[i+1]&&!Object.hasOwn(values,args[i]),'Expected unique --origin/--expected-commit/--catalogs/--output options');values[args[i]]=args[i+1];}
  return values;
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]) {
  const values=parseOptions(process.argv.slice(2));
  const result=await runSmoke({origin:values['--origin'],expectedCommit:values['--expected-commit'],catalogs:values['--catalogs']?values['--catalogs'].split(','):[]},fetchBounded);
  const bytes=JSON.stringify(result,null,2)+'\n';
  if(values['--output'])fs.writeFileSync(values['--output'],bytes,{flag:'wx',mode:0o600});
  process.stdout.write(bytes);
}
