/** Reconcile every inventoried registration and public contract to coverage or a named gap. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {packet, emit} from './census.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(packet,name)));
const registrations=read('registrations.json'),contracts=read('contracts.json'),entries=read('public-entry-review.json');
const registrationRows=[...registrations.registrations,...registrations.browserRoutes,...registrations.lifecycleCandidates];
const coverageOf=row=>row.coverage||row.coverageGap||row.status;
const gapsOf=row=>row.gapId||row.coverageGap||row.nextAction;
const registrationIssues=registrationRows.map(row=>({id:row.id,coverage:coverageOf(row),gap:gapsOf(row)}))
  .filter(row=>!row.coverage && !row.gap);
const caseIds=new Set(contracts.cases.map(item=>item.id));
const contractIssues=contracts.contracts.map(contract=>({id:contract.id,missing:contract.caseIds.filter(id=>!caseIds.has(id)),gap:contract.gap}))
  .filter(row=>row.missing.length);
const entryIssues=entries.entries.map(entry=>({entry:entry.entry,missing:entry.contractIds.filter(id=>!contracts.contracts.some(contract=>contract.id===id))}))
  .filter(row=>row.missing.length);
const buckets={gratitudeRehearsal:contracts.contracts.filter(c=>c.id.startsWith('CTR-GR-')).map(c=>c.id),globallyAffectedPrerequisites:contracts.contracts.filter(c=>!c.id.startsWith('CTR-GR-')).map(c=>c.id)};
const coverageBuckets=Object.fromEntries([...new Set(registrationRows.map(coverageOf))].map(key=>[key,registrationRows.filter(row=>coverageOf(row)===key).length]));
emit('coverage-map-review.json',{schema:'daylight.preimplementation.coverage-map-review/v1',inventoryInputs:['registrations.json','contracts.json','public-entry-review.json'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(packet,name)))})),summary:{registrations:registrations.registrations.length,browserRoutes:registrations.browserRoutes.length,lifecycleCandidates:registrations.lifecycleCandidates.length,contractFamilies:contracts.contracts.length,publicEntries:entries.entries.length,coverageBuckets,gratitudeContracts:buckets.gratitudeRehearsal.length,globalPrerequisiteContracts:buckets.globallyAffectedPrerequisites.length,passed:!registrationIssues.length&&!contractIssues.length&&!entryIssues.length},buckets,registrationIssues,contractIssues,entryIssues,limits:['A named gap is accountable coverage disposition, not a passing test.','Globally affected prerequisite families remain separate from the Gratitude rehearsal population.'],toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});
process.stdout.write(JSON.stringify({registrationRows:registrationRows.length,contracts:contracts.contracts.length,entries:entries.entries.length,registrationIssues:registrationIssues.length,contractIssues:contractIssues.length,entryIssues:entryIssues.length})+'\n');
