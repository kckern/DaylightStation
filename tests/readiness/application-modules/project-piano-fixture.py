# Independent Piano source/backing projector; no HTTP or product helpers.
import json,pathlib,yaml,hashlib,datetime,itertools,os,urllib.parse,collections
import sys
os.umask(0o077)
repo=pathlib.Path(__file__).resolve().parents[3]
root=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
hh=yaml.safe_load((root/'household/household.yml').read_text())
uid=hh['head'];avail={'users':[{'userId':u if isinstance(u,str) else u['id']} for u in hh['users']]}
urls=json.load(open(repo/'tests/readiness/application-modules/http-expected-installed-route-matrix.json'))
# Declaration identity comes from the complete pinned source graph. Coverage
# linkage may remove accepted URLs from the backlog without changing identity.
rt={}
for declaration in urls['declarations']:
 for template in declaration['urlTemplates']:
  row=rt.setdefault(template,{'declarationIds':[],'sourceProof':[]})
  row['declarationIds'].append(declaration['declarationId'])
  row['sourceProof']=list(dict.fromkeys(row['sourceProof']+declaration['sourceProof']))
cases=[];inputs=[];files={};raw=[];rawdir=out/'raw-utf8';rawdir.mkdir(mode=0o700,exist_ok=True)
def jsjson(v):
 if isinstance(v,datetime.datetime):return v.astimezone(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') if v.tzinfo else v.isoformat(timespec='milliseconds')+'Z'
 if isinstance(v,datetime.date):return v.isoformat()+'T00:00:00.000Z'
 if isinstance(v,dict):return {k:jsjson(a) for k,a in v.items()}
 if isinstance(v,list):return [jsjson(a) for a in v]
 return v
def read(p,include=True,rawRequired=False):
 p=pathlib.Path(p);by=p.read_bytes();assert p.resolve()==p and len(by)<=1048576;st=p.stat();dest='data/'+str(p.relative_to(root));inputs.append({'path':str(p),'sha256':hashlib.sha256(by).hexdigest(),'dev':st.st_dev,'ino':st.st_ino,'destination':dest});val=yaml.safe_load(by.decode()) or {}
 if include:files[dest]=jsjson(val)
 if rawRequired:
  target=rawdir/(hashlib.sha256(dest.encode()).hexdigest()+'.txt');target.write_bytes(by);raw.append({'destination':dest,'sourceFile':str(target),'sha256':hashlib.sha256(by).hexdigest(),'byteLength':len(by),'encoding':'utf8','reason':'Preserve original YAML type semantics or raw MusicXML bytes; no JSON serialization'})
 return val
def add(cid,path,template,equals,branch='populated',status=200,required=None,rawRequired=False,scope=None):
 req=required or {k:'array' if isinstance(v,list) else 'object' if isinstance(v,dict) else 'boolean' if isinstance(v,bool) else 'number' if isinstance(v,(int,float)) else 'string' for k,v in equals.items() if v is not None}
 case={'id':cid,'method':'GET','path':path,'safety':{'reviewed':True,'disposition':'read-only','sideEffects':False,'nonlocal':False,'longLived':False},'expected':{'status':status,'headers':{'content-type':'application/json; charset=utf-8'},'body':{'kind':'json','required':req,'equals':jsjson(equals)}},'normalize':{'jsonPaths':[],'headers':['date','connection','keep-alive','content-length']}}
 cases.append({'case':case,'branch':branch,'urlTemplate':template,'declarationIds':rt[template]['declarationIds'],'sourceProof':rt[template]['sourceProof'],'rawUTF8FixtureRequired':rawRequired,'expectedScope':scope or 'Independently parsed original stored inputs and separate Python projection; no API/service/presenter called','executionAuthorized':False})
up=root/'users'/uid/'apps/piano';studio=[]
for p in sorted((up/'studio').glob('*.yml')):
 d=read(p);sid=p.stem;studio.append({'id':sid,'title':d.get('title') or sid,'created':d.get('created') or None,'durationMs':d.get('durationMs') or 0,'eventCount':len(d['events']) if isinstance(d.get('events'),list) else 0,'favorite':bool(d.get('favorite'))})
add('piano-private-studio-list','/api/v1/piano/users/'+uid+'/studio','/api/v1/piano/users/:userId/studio',{'takes':studio})
sid=sorted((up/'studio').glob('*.yml'))[0].stem;val=yaml.safe_load((up/'studio'/(sid+'.yml')).read_text());add('piano-private-studio-detail','/api/v1/piano/users/'+uid+'/studio/'+sid,'/api/v1/piano/users/:userId/studio/:id',val)
meta=[]
for p in sorted((up/'composer').glob('*.meta.yml')):
 d=read(p);meta.append({'id':d.get('id'),'title':d.get('title'),'tags':d.get('tags') or [],'share':bool(d.get('share')),'updatedAt':d.get('updatedAt'),'revision':d.get('revision')})
assert all(isinstance(d.get('updatedAt'),str) for d in meta),'Raw timestamp types must be preserved before sorting';meta.sort(key=lambda d:d['updatedAt'],reverse=True);add('piano-private-composition-list','/api/v1/piano/users/'+uid+'/compositions','/api/v1/piano/users/:userId/compositions',{'compositions':meta})
mdpath=sorted((up/'composer').glob('*.meta.yml'))[0];md=yaml.safe_load(mdpath.read_text());xmlpath=mdpath.with_name(mdpath.name.replace('.meta.yml','.musicxml'));xml=xmlpath.read_bytes();xml.decode('utf8');dest='data/'+str(xmlpath.relative_to(root));saved=rawdir/(hashlib.sha256(dest.encode()).hexdigest()+'.txt');saved.write_bytes(xml);raw.append({'destination':dest,'sourceFile':str(saved),'sha256':hashlib.sha256(xml).hexdigest(),'byteLength':len(xml),'encoding':'utf8','reason':'MusicXML detail uses readFile; JSON-stringified text would alter response bytes'});st=xmlpath.stat();inputs.append({'path':str(xmlpath),'sha256':hashlib.sha256(xml).hexdigest(),'dev':st.st_dev,'ino':st.st_ino,'destination':dest});add('piano-private-composition-detail','/api/v1/piano/users/'+uid+'/compositions/'+md['id'],'/api/v1/piano/users/:userId/compositions/:id',{'meta':md,'musicxml':xml.decode('utf8')},rawRequired=True)
# Shared list reads all roster metadata; no source record marked share: explicit true empty, never invented populated case.
shared=[]
for entry in avail['users']:
 u=entry['userId']
 for p in sorted((root/'users'/u/'apps/piano/composer').glob('*.meta.yml')):
  d=read(p)
  if d.get('share'):shared.append({'userId':u,'id':d.get('id'),'title':d.get('title'),'tags':d.get('tags') or []})
add('piano-shared-compositions-empty','/api/v1/piano/compositions/shared','/api/v1/piano/compositions/shared',{'compositions':shared},branch='source-empty-shared-flags')
prpath=sorted((up/'practice').glob('*.yml'))[0];pv=read(prpath);add('piano-private-practice-score','/api/v1/piano/users/'+uid+'/practice/'+prpath.stem,'/api/v1/piano/users/:userId/practice/:scoreKey',pv)
# Producer source baseline: original YAML timestamp tags deserialize as Date and fail strict string validation.
# The stored object is not repaired; list contains no healthy items. Error details retained for comparison but not claimed independently derived.
for fam in ['loops','crate','songs']:
 ps=sorted((root/'household/piano/producer'/fam).glob('*.yml'));parsed=[]
 for p in ps:
  d=read(p,include=False,rawRequired=True);assert isinstance(d.get('created'),(datetime.datetime,datetime.date)) and isinstance(d.get('modified'),(datetime.datetime,datetime.date));parsed.append((p.stem,d))
 add('piano-producer-'+fam+'-baseline-list','/api/v1/piano/producer/'+fam,'/api/v1/piano/producer/'+fam,{'items':[]},branch='baseline-validator-failure-list',required={'items':'array','invalidRecords':'array'},rawRequired=True,scope='Every original record independently fails timestamp string requirement; exact no-healthy-items. InvalidRecords complete errors/order require full comparison; no healthy populated credit.')
 pid=parsed[0][0];add('piano-producer-'+fam+'-baseline-detail','/api/v1/piano/producer/'+fam+'/'+pid,'/api/v1/piano/producer/'+fam+'/:id',{'error':'Stored Producer record is invalid','code':'PRODUCER_RECORD_INVALID','id':pid},branch='baseline-validator-failure-detail',status=422,required={'error':'string','code':'string','id':'string','errors':'array'},rawRequired=True,scope='Independently known typed timestamp/string incompatibility proves422. Additional error strings not independently asserted; no healthy Producer correctness claim.')
# Entire authored bank is needed for unfiltered index/catalog/search responses:72 bounded YAML files,60 seeds.
bank=root/'content/music';categories=sorted(str(p.relative_to(bank)) for p in bank.rglob('*') if p.is_dir() and not any(s.startswith(('_','.')) for s in p.relative_to(bank).parts));seedrows=[];cats=[];index=None
for p in sorted(bank.rglob('*.yml')):
 if any(s.startswith(('_','.')) for s in p.relative_to(bank).parts):continue
 d=read(p)
 if p.parent==bank and p.name=='index.yml':index=d
 elif p.name=='index.yml':pass
 else:seedrows.append((str(p.relative_to(bank)).removesuffix('.yml'),d))
for cat in categories:
 cp=bank/cat/'index.yml';d=yaml.safe_load(cp.read_text()) if cp.exists() else {};d=d or {};cats.append({'id':cat,'title':d.get('title') or cat.split('/')[-1],'subtitle':d.get('subtitle'),'ordered':bool(d.get('ordered')),'parent':cat.rsplit('/',1)[0] if '/' in cat else None})
def axisvals(ax):
 v=ax.get('values')
 if v=='all':return ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
 if v=='range':return list(range(int(ax['from']),int(ax['to'])+1))
 return v if isinstance(v,list) else []
def combos(seed):
 result=[{}]
 for n,a in (seed.get('expansion',{}).get('axes') or {}).items():
  vs=axisvals(a)
  if vs:result=[{**d,n:v} for d in result for v in vs]
 return result
def instanceid(seed,axes):return seed['id']+('@'+','.join(n+'='+str(v.get('id') if isinstance(v,dict) else v) for n,v in axes.items()) if axes else '')
# Catalog/search count realizable variants, not every Cartesian axis tuple.
# Independent pitch arithmetic checks only the finite keyboard range contract;
# it does not claim complete event, shape, difficulty or musical correctness.
def fits_keyboard(seed,axes):
 assert set(axes)<=set(['root','quality','mode','inversion','staff','direction','span_octaves','pitch','hand']), 'Unreviewed authored pitch axis'
 pitches=[[n['midi'] for n in event['notes']] for event in seed['events']]
 anchor=min(v for event in pitches for v in event)
 recipe=axes.get('quality',axes.get('mode'));intervals=recipe.get('intervals') if isinstance(recipe,dict) else None
 if intervals:
  pitches=[[anchor+i for i in intervals]] if len(pitches)==1 else [[anchor+i] for i in intervals]
 inversion={'root':0,'1st':1,'2nd':2,'3rd':3}.get(axes.get('inversion'),0)
 if inversion and len(pitches)==1 and len(pitches[0])>1:
  chord=sorted(pitches[0])
  for _ in range(inversion):chord.append(chord.pop(0)+12)
  pitches=[chord]
 notes=[v for event in pitches for v in event]
 shift=0
 if 'pitch' in axes:shift=axes['pitch']-anchor
 elif 'root' in axes:
  classes={'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11}
  shift=(classes[axes['root']]-classes.get(seed.get('key'),anchor%12))%12
 low=min(notes)+shift;high=max(notes)+shift
 span=axes.get('span_octaves',1)
 if span>1 and len(pitches)>1:high+=12*(span-1)
 if axes.get('hand') in ['L','RL']:low-=12
 if axes.get('hand')=='L':high-=12
 return low>=21 and high<=108
# Independent boundary controls for range, recipe, transposition and hand shifts.
assert fits_keyboard({'events':[{'notes':[{'midi':21}]}]}, {})
assert not fits_keyboard({'events':[{'notes':[{'midi':20}]}]}, {})
assert not fits_keyboard({'key':'C','events':[{'notes':[{'midi':108}]}]}, {'root':'C#'})
assert not fits_keyboard({'events':[{'notes':[{'midi':21}]}]}, {'hand':'L'})
assert fits_keyboard({'events':[{'notes':[{'midi':100}]}]}, {'quality':{'intervals':[0,4,8]}})
assert not fits_keyboard({'events':[{'notes':[{'midi':100}]}]}, {'quality':{'intervals':[0,4,9]}})
assert index;add('piano-authored-bank-index','/api/v1/piano/bank','/api/v1/piano/bank',index)
cartesianCounts=[len(combos(s)) for _,s in seedrows];counts=[sum(fits_keyboard(s,c) for c in combos(s)) for _,s in seedrows];assert all(s.get('events') for _,s in seedrows);add('piano-authored-bank-catalog','/api/v1/piano/bank/catalog','/api/v1/piano/bank/catalog',{'title':index.get('title') or 'Exercise Library','categories':cats,'totals':{'seeds':len(seedrows),'variants':sum(counts)}},required={'title':'string','categories':'array','seeds':'array','totals':'object'},scope='Independent full authored categories, seed count and keyboard-valid variant total; Cartesian tuples counted separately. Computed seed level/shape entries checked by full migration comparison only; no independent per-instance music correctness credit.')
assert all('level' not in s for _,s in seedrows), 'Authored level override needs separate search contract'
# Source free-mode derived levels clamp to1..10, so every keyboard-valid free-supported variant passes defaults.
total=sum(n for (_,s),n in zip(seedrows,counts) if 'free' in (s.get('supports') or ['free']));add('piano-authored-bank-search-zero-page','/api/v1/piano/bank/search?mode=free&limit=0','/api/v1/piano/bank/search',{'total':total,'instances':[]},branch='populated-count-zero-page',required={'total':'number','facets':'object','instances':'array'},scope='Independent nonzero full-bank keyboard-valid free-mode count and deliberately zero-length page; facets/computed levels require migration comparison only, not empty-search correctness credit.')
skey,seed=seedrows[0];add('piano-authored-bank-seed-detail','/api/v1/piano/bank/'+skey,'/api/v1/piano/bank/*splat',{**seed,'instances':len(combos(seed))})
ids=[instanceid(seed,c) for c in combos(seed)];add('piano-authored-bank-instance-ids','/api/v1/piano/bank/'+skey+'/instances?limit=5','/api/v1/piano/bank/*splat',{'seed_id':seed['id'],'total':len(ids),'instance_ids':ids[:5]},branch='populated-axis-ids')
# Reserved missing paths are explicitly guarded against this finite bank snapshot.
missing='readiness-absent-seed';assert not (bank/(missing+'.yml')).exists() and not (bank/missing).exists();inputs.append({'path':str(bank/(missing+'.yml')),'absent':True});inputs.append({'path':str(bank/missing),'absent':True});add('piano-authored-bank-absent','/api/v1/piano/bank/'+missing,'/api/v1/piano/bank/*splat',{'error':'Not found in the bank','path':missing},branch='not-found',status=404)
# Snapshot directory membership for list completeness, source read side never writes.
listingdirs={str(pathlib.Path(a['path']).parent) for a in inputs if a.get('sha256')}
for entry in avail['users']:
 p=root/'users'/entry['userId']/'apps/piano/composer'
 if p.exists():assert p.resolve()==p and p.is_dir();listingdirs.add(str(p))
 else:inputs.append({'path':str(p),'absent':True})
listingdirs.update(str(bank/cat) for cat in categories)
dirs=sorted(listingdirs);dirguards=[]
for dirname in dirs:
 p=pathlib.Path(dirname);dirguards.append({'path':dirname,'names':sorted(f.name for f in p.iterdir()),'scope':'Complete source listing membership guard; not copied wholesale beyond selected files'})
inputs=list({a['path']:a for a in inputs}.values());raw=list({a['destination']:a for a in raw}.values());assert sum(a['byteLength'] for a in raw)<=8388608
plan={'candidateCommit':'c6ac6e69f8c104a968c397931c92dc55df1297f4','referenceCommit':'14beb0cc931b3e87dc578d4f09dc0e4dbaa63cbd','cases':cases,'fixtureDelta':{'files':files,'rawUTF8Files':raw},'backingInputs':inputs,'backingDirectories':dirguards,'sourceBaselineFindings':[{'id':'piano-producer-yaml-timestamp-type','records':130,'allOriginalRecordsInvalidDueToDateTypes':True,'noHealthyPopulatedCredit':True,'JSONCoercionWouldMaskBaseline':True}],'gaps':[{'templates':['/api/v1/piano/lessons/:collection','/api/v1/piano/lessons/:collection/:id'],'reason':'Configured Docker media root not available on host; exact mounted host media root/source identity needed. No fake lessons or unproved absent-live contract.'}],'rawUTF8CapabilityProposal':{'schema':'daylight.readonly-raw-utf8-fixture-proposal/v1','fileFields':['destination','sourceFile','sha256','byteLength','encoding'],'destinationAllowlist':['data/household/piano/producer/{loops,crate,songs}/[a-z0-9-]+.yml','data/users/EXISTING_ROSTER_USER/apps/piano/composer/[a-z0-9-]+.musicxml'],'maxBytesPerFile':1048576,'maxTotalBytes':8388608,'requiredChecks':['Exact private proof-index destination andsource SHA/byte count before copy, guarded before/after run','Destination relative canonical path; reject absolute/.., symlink inputs/destinations, duplicate/JSON collision, protected configuration paths','UTF8 decode must succeed; no arbitrary binary/executable data, no discovery/additionaldestinations','Use existing safe fixture writer boundaries and fixed permissions; raw bytes only into disposable scratch, no source mutation','Named raw scope reviewed separately from JSON contract fixture; preserve YAML tags and MusicXML exact text','Fixture/provenance/source proof pins must be renewed by APIworker/root after frozen suite, no global weakening'],'status':'Proposal only; current probe JSON.stringify cannot execute these raw-dependent cases faithfully'}}
for name,obj in [('piano-caseplan-private.json',plan),('piano-readonly-expectations-proposal.json',{'schema':'comparator-v1','cases':[c['case'] for c in cases]}),('piano-json-fixture-delta.json',{'files':files}),('piano-raw-utf8-files-proposal.json',{'files':raw})]:(out/name).write_text(json.dumps(obj,indent=2,ensure_ascii=False)+'\n')
public={'schema':'daylight.sanitized-piano-pack-plan/v1','scope':'Scratch-only proposal; noHTTP/approval/currentproof change','selectedUserRole':'Existing household source profile; identifier only in0600privateplan','caseCount':len(cases),'templatesPrepared':len({c['urlTemplate'] for c in cases}),'uniqueDeclarationIds':len({d for c in cases for d in c['declarationIds']}),'currentlyJSONSupportedCases':sum(not c['rawUTF8FixtureRequired'] for c in cases),'rawUTF8DependentCases':sum(c['rawUTF8FixtureRequired'] for c in cases),'backingFiles':sum('sha256' in a for a in inputs),'authoredBankSeedCount':len(seedrows),'authoredBankVariantCount':sum(counts),'authoredBankCartesianVariantCount':sum(cartesianCounts),'selectedStudioTakes':len(studio),'selectedCompositionMetadata':len(meta),'sharedCompositionRecords':len(shared),'producerRecords':130,'rawFiles':len(raw),'rawBytes':sum(a['byteLength'] for a in raw),'cases':[{'id':c['case']['id'],'template':c['urlTemplate'],'declarationIds':c['declarationIds'],'branch':c['branch'],'rawUTF8Required':c['rawUTF8FixtureRequired'],'sourceProof':c['sourceProof'],'expectedScope':c['expectedScope']} for c in cases],'gaps':plan['gaps'],'baselineFindings':plan['sourceBaselineFindings'],'rawUTF8CapabilityProposal':plan['rawUTF8CapabilityProposal'],'executionAuthorized':False};(out/'piano-caseplan-sanitized.json').write_text(json.dumps(public,indent=2)+'\n');print({k:public[k] for k in ['caseCount','templatesPrepared','uniqueDeclarationIds','currentlyJSONSupportedCases','rawUTF8DependentCases','backingFiles','authoredBankSeedCount','authoredBankVariantCount','selectedStudioTakes','selectedCompositionMetadata','sharedCompositionRecords','rawFiles','rawBytes']})
