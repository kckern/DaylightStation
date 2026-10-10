import ast,copy,json,pathlib,re,sys,unittest
root=pathlib.Path(__file__).resolve().parent
script=pathlib.Path(sys.argv.pop(1)) if len(sys.argv)>1 else root/'reconcile-http-denominator.py'
base=pathlib.Path(sys.argv.pop(1)) if len(sys.argv)>1 else root
ns={'re':re};tree=ast.parse(script.read_text());functions=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['reconcile_conditional_reads','conditional_request_admitted']]
exec(compile(ast.Module(body=functions,type_ignores=[]),str(script),'exec'),ns)
fixtures=[json.loads((base/name).read_text()) for name in ['http-reviewed-effect-facts.json','http-readonly-eligibility.json','http-expected-installed-route-matrix.json']]
read={r['declarationId']:dict(r,method='get') for r in fixtures[1]['declarations']}
class Controls(unittest.TestCase):
 def data(self):return copy.deepcopy(fixtures)
 def reconcile(self,data=None):return ns['reconcile_conditional_reads'](*(data or self.data()),read)
 def test_reviewed_records_derive_union_without_reclassification(self):
  data=self.data();before=copy.deepcopy(data);out=self.reconcile(data);self.assertEqual(out['potentialEligibleExpectedSourceURLTemplates'],before[2]['counts']['potentialEligibleExpectedSourceURLTemplates']);self.assertEqual(out['potentialEligibleHandlerWideSourceURLTemplates'],384);self.assertEqual(out['potentialEligibleExplicitBranchConditionalSourceURLTemplates'],len({r['urlTemplate'] for r in before[0]['conditionalReadAdmissions'] if r.get('denominatorContribution')!='none-existing-template'}));self.assertEqual(data,before)
 def test_history_and_diagnostic_do_not_gain_correctness_credit(self):
  data=self.data();before=copy.deepcopy(data[2]['isolatedAndLiveEvidenceUnion']);self.reconcile(data);self.assertEqual(data[2]['isolatedAndLiveEvidenceUnion'],before);self.assertEqual(before['counts'],fixtures[2]['isolatedAndLiveEvidenceUnion']['counts']);self.assertTrue(next(r for r in self.reconcile()['conditionalReadAdmissions'] if r['urlTemplate']=='/api/v1/school/certification')['diagnosticOnly'])
 def test_registry_retained_exactly(self):self.assertEqual(self.reconcile()['conditionalReadAdmissions'],fixtures[0]['conditionalReadAdmissions'])
 def reject(self,mutate):
  data=self.data();mutate(data)
  with self.assertRaises(AssertionError):self.reconcile(data)
 def edit_all(self,data,key,value):
  for artifact in data:
   artifact['conditionalReadAdmissions'][0][key]=value
   if 'declarations' in artifact:
    for d in artifact['declarations']:
     if d.get('conditionalReadAdmissions'):d['conditionalReadAdmissions']=[r for r in artifact['conditionalReadAdmissions'] if r['declarationId']==d['declarationId']]
 def test_missing_registry_mirror(self):self.reject(lambda d:d[1].pop('conditionalReadAdmissions'))
 def test_duplicate_admission(self):self.reject(lambda d:d[0]['conditionalReadAdmissions'].append(copy.deepcopy(d[0]['conditionalReadAdmissions'][0])))
 def test_unbound_declaration(self):self.reject(lambda d:self.edit_all(d,'declarationId','unknown'))
 def test_unmounted_template(self):self.reject(lambda d:self.edit_all(d,'urlTemplate','/not-mounted'))
 def test_mutation_method(self):
  def mutate(d):
   for a in d:a['conditionalReadAdmissions'][0]['requestCases'][0]['method']='POST'
  self.reject(mutate)
 def test_arbitrary_url(self):
  def mutate(d):
   for a in d:a['conditionalReadAdmissions'][0]['requestCases'][0]['path']='/api/v1/device/desk/on'
  self.reject(mutate)
 def test_bad_packet_hash(self):self.reject(lambda d:self.edit_all(d,'approvedPackets',[{'fixtureSha256':'bad','manifestSha256':'bad'}]))
 def test_unreviewed(self):self.reject(lambda d:self.edit_all(d,'independentReview',{'path':'','sha256':'bad'}))
 def test_no_prerequisites(self):self.reject(lambda d:self.edit_all(d,'safetyPrerequisites',''))
 def test_denominator_drift(self):self.reject(lambda d:d[2]['counts'].__setitem__('potentialEligibleExpectedSourceURLTemplates',390))
 def test_omitted_declaration_metadata(self):
  def mutate(d):
   decl=next(x for x in d[1]['declarations'] if x.get('conditionalReadAdmissions'));del decl['conditionalReadAdmissions']
  self.reject(mutate)
 def test_matching_exact_request_and_packet_pair(self):
  a=fixtures[0]['conditionalReadAdmissions'][0];c=a['requestCases'][0];p=a['approvedPackets'][0]
  self.assertTrue(ns['conditional_request_admitted']([a],c['id'],'GET',c['path'],p['fixtureSha256'],p['manifestSha256']))
 def test_crossed_hash_pairs_not_admitted(self):
  a=fixtures[0]['conditionalReadAdmissions'][0];c=a['requestCases'][0]
  self.assertFalse(ns['conditional_request_admitted']([a],c['id'],'GET',c['path'],a['approvedPackets'][0]['fixtureSha256'],a['approvedPackets'][1]['manifestSha256']))
 def test_wrong_id_method_query_or_hash_not_admitted(self):
  a=fixtures[0]['conditionalReadAdmissions'][0];c=a['requestCases'][0];p=a['approvedPackets'][0];args=[c['id'],'GET',c['path'],p['fixtureSha256'],p['manifestSha256']]
  for i,v in enumerate(['different-id','POST',c['path']+'?unreviewed=1','0'*64,'0'*64]):
   changed=args.copy();changed[i]=v;self.assertFalse(ns['conditional_request_admitted']([a],*changed))
 def test_legacy_no_conditional_records_derives_384(self):
  data=self.data()
  for artifact in data:
   artifact.pop('conditionalReadAdmissions',None)
   for d in artifact.get('declarations',[]):d.pop('conditionalReadAdmissions',None)
  for k,v in {'potentialEligibleExpectedSourceURLTemplates':384,'potentialEligibleUnconditionalConstructionURLTemplates':382,'potentialEligibleConditionalConstructionURLTemplates':2}.items():data[2]['counts'][k]=v
  for k in ['potentialEligibleHandlerWideSourceURLTemplates','potentialEligibleExplicitBranchConditionalSourceURLTemplates']:data[2]['counts'].pop(k,None)
  out=self.reconcile(data);self.assertEqual(out['potentialEligibleExpectedSourceURLTemplates'],384);self.assertEqual(out['conditionalReadAdmissions'],[])
unittest.main()
