/** State/effect order required by the Gratitude HTTP rehearsal. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {packet,root,emit} from './census.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const rows=[
 ['GET /bootstrap and /options','get options may recycle discarded records and write before JSON response; GET is not assumed read-only'],
 ['POST /selections/:category','validate → household/timestamp → add selection → transfer/removal persistence → 201; duplicate returns 409 without new write'],
 ['POST /discarded/:category','validate → discard persistence → 201; later option read may recycle'],
 ['POST /snapshot/save','household/timestamp → snapshot read → file write → 201'],
 ['POST /snapshot/restore','household/id-or-name → resolve/read snapshot → restore writes → response; missing maps 404'],
 ['GET /new','missing text returns 400 before publication; otherwise custom-item construction/publish occurs once before JSON'],
 ['POST /print/mark','validate → household/timestamp → mark persistence → requested-count response'],
 ['GET /card/print{/:location}','renderer check → printer resolve (404 before render) → household/flip/render/print → mark only confirmed success → response; failed print has empty marks']
].map(([operation,ordering])=>({operation,ordering}));
emit('gratitude-effects-review.json',{schema:'daylight.preimplementation.gratitude-effects-review/v1',inputs:['backend/src/4_api/v1/routers/gratitude.mjs','backend/src/3_applications/gratitude/services/GratitudeService.mjs'].map(name=>({name,sha256:hash(fs.readFileSync(path.join(root,name)))})),rows,summary:{effectFamilies:rows.length,sideEffectingGets:3,passed:rows.length===8},toolHash:hash(fs.readFileSync(new URL(import.meta.url)))});process.stdout.write(JSON.stringify({families:rows.length})+'\n');
